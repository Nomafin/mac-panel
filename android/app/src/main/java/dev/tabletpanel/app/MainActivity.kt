package dev.tabletpanel.app

import android.app.Activity
import android.app.ActivityManager
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import kotlin.math.abs

/**
 * The whole app: the panel page full screen, acting as the tablet's home screen.
 * Hardware keys go to the page as `tablet-key` events; the page can dim the screen.
 */
class MainActivity : Activity() {

    private companion object {
        const val RETRY_MS = 5000L
        const val MENU_HOLD_MS = 3000L
        const val CORNER_DP = 64
        const val PREF_URL = "url"
    }

    private lateinit var web: WebView
    private lateinit var waiting: TextView
    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("panel", MODE_PRIVATE) }
    private val url get() = prefs.getString(PREF_URL, null) ?: MacUrl.DEFAULT

    private var loadFailed = false
    private val retry = Runnable { load() }

    private var holdX = 0f
    private var holdY = 0f
    private val holdMenu = Runnable { openMenuFromHold() }

    private val recentsReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (!Keys.isRecentsReason(intent.getStringExtra("reason"))) return
            (getSystemService(ACTIVITY_SERVICE) as ActivityManager).moveTaskToFront(taskId, 0)
            sendKey("recents")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true) // chrome://inspect from the Mac
        }

        web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            addJavascriptInterface(Bridge(), "TabletApp")
            webViewClient = Client()
        }
        waiting = TextView(this).apply {
            setTextColor(Color.rgb(0x8e, 0x8c, 0x99))
            textSize = 22f
            gravity = Gravity.CENTER
            visibility = View.GONE
        }
        setContentView(FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(web)
            addView(waiting)
        })

        @Suppress("DEPRECATION") // only stops reaching apps on Android 12+; this tablet runs 7
        val filter = IntentFilter(Intent.ACTION_CLOSE_SYSTEM_DIALOGS)
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(recentsReceiver, filter, RECEIVER_EXPORTED)
        } else {
            registerReceiver(recentsReceiver, filter)
        }
        load()
    }

    override fun onDestroy() {
        unregisterReceiver(recentsReceiver)
        handler.removeCallbacksAndMessages(null)
        web.destroy()
        super.onDestroy()
    }

    /* ----- loading, and waiting while the Mac can't be reached ----- */

    private fun load() {
        handler.removeCallbacks(retry)
        loadFailed = false
        web.loadUrl(url)
    }

    private fun showWaiting() {
        loadFailed = true
        web.visibility = View.INVISIBLE
        waiting.text = "Waiting for your Mac…\n\n$url"
        waiting.visibility = View.VISIBLE
        handler.removeCallbacks(retry)
        handler.postDelayed(retry, RETRY_MS)
    }

    private inner class Client : WebViewClient() {
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showWaiting()
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame) showWaiting()
        }

        override fun onPageFinished(view: WebView, url: String) {
            if (loadFailed) return
            waiting.visibility = View.GONE
            web.visibility = View.VISIBLE
        }
    }

    /* ----- page bridge ----- */

    private fun sendKey(key: String) = web.evaluateJavascript(Keys.eventScript(key), null)

    private inner class Bridge {
        /** Dark = minimum brightness; the page draws black on top, so the AMOLED pixels are off. */
        @JavascriptInterface
        fun setScreen(on: Boolean) = runOnUiThread {
            window.attributes = window.attributes.apply {
                screenBrightness = if (on) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE else 0f
            }
        }
    }

    /* ----- hardware keys ----- */

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val key = Keys.forKeyCode(event.keyCode) ?: return super.dispatchKeyEvent(event)
        // Back acts on release, like everywhere in Android; volume keys on press. Repeats are dropped:
        // the cover can hold a volume key down.
        val fireOn = if (event.keyCode == KeyEvent.KEYCODE_BACK) KeyEvent.ACTION_UP else KeyEvent.ACTION_DOWN
        if (event.action == fireOn && event.repeatCount == 0) sendKey(key)
        return true
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasCategory(Intent.CATEGORY_HOME)) sendKey("home")
    }

    /* ----- full screen ----- */

    override fun onResume() {
        super.onResume()
        hideSystemBars()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    @Suppress("DEPRECATION") // the replacement (WindowInsetsController) needs Android 11
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
    }

    /* ----- escape menu: hold the top-left corner for 3 s ----- */

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        val corner = CORNER_DP * resources.displayMetrics.density
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> if (event.x < corner && event.y < corner) {
                holdX = event.x
                holdY = event.y
                handler.postDelayed(holdMenu, MENU_HOLD_MS)
            }
            MotionEvent.ACTION_MOVE -> {
                val slop = ViewConfiguration.get(this).scaledTouchSlop
                if (abs(event.x - holdX) > slop || abs(event.y - holdY) > slop) handler.removeCallbacks(holdMenu)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN ->
                handler.removeCallbacks(holdMenu)
        }
        return super.dispatchTouchEvent(event)
    }

    private fun openMenuFromHold() {
        // The page saw the finger go down; tell it the press is over so nothing stays pressed.
        val now = SystemClock.uptimeMillis()
        val cancel = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, holdX, holdY, 0)
        super.dispatchTouchEvent(cancel)
        cancel.recycle()
        showMenu()
    }

    private fun showMenu() {
        val items = arrayOf("Reload", "Mac address…", "Android settings", "Choose home app")
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Mac Panel")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> load()
                    1 -> editUrl()
                    2 -> startActivity(Intent(Settings.ACTION_SETTINGS))
                    3 -> openHomeSettings()
                }
            }
            .show()
    }

    private fun openHomeSettings() {
        try {
            startActivity(Intent(Settings.ACTION_HOME_SETTINGS))
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_SETTINGS)) // Samsung: Apps → Default apps → Home screen
        }
    }

    private fun editUrl() {
        val input = EditText(this).apply {
            setText(url)
            setSingleLine()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        }
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Mac address")
            .setView(input)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ ->
                val normalized = MacUrl.normalize(input.text.toString())
                if (normalized == null) {
                    Toast.makeText(this, "That isn't a valid address", Toast.LENGTH_LONG).show()
                } else {
                    prefs.edit().putString(PREF_URL, normalized).apply()
                    load()
                }
            }
            .show()
    }
}
