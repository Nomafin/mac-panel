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
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
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

/**
 * The whole app: the panel page full screen, acting as the tablet's home screen.
 * Hardware keys go to the page as `tablet-key` events; the page can dim the screen.
 */
class MainActivity : Activity() {

    private companion object {
        const val RETRY_MS = 5000L
        const val PREF_URL = "url"
    }

    private lateinit var web: WebView
    private lateinit var waiting: TextView
    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("panel", MODE_PRIVATE) }
    private val url get() = prefs.getString(PREF_URL, null) ?: MacUrl.DEFAULT

    private var loadFailed = false
    private val retry = Runnable { load() }
    private var waitingSince = 0L
    private var waitingPeekUntil = 0L
    private val waitingTick = object : Runnable {
        override fun run() {
            applyWaitingDark()
            handler.postDelayed(this, 1000)
        }
    }

    private var resumed = false
    private var pausedAt = 0L

    private val backHold = BackHold()
    private val backHeld = Runnable { if (backHold.heldLongEnough()) showMenu() }

    private val recentsReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (!Keys.isRecentsReason(intent.getStringExtra("reason"))) return
            if (!Keys.shouldBounce(resumed, pausedAt, SystemClock.uptimeMillis())) return
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
            setOnClickListener {
                waitingPeekUntil = SystemClock.uptimeMillis() + Waiting.PEEK_MS
                applyWaitingDark()
            }
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
        if (waiting.visibility != View.VISIBLE) {
            waiting.visibility = View.VISIBLE
            waitingSince = SystemClock.uptimeMillis()
            waitingPeekUntil = 0L
            handler.post(waitingTick)
        }
        handler.removeCallbacks(retry)
        handler.postDelayed(retry, RETRY_MS)
    }

    private fun hideWaiting() {
        handler.removeCallbacks(waitingTick)
        waiting.visibility = View.GONE
        waiting.alpha = 1f
        setBrightness(on = true) // the page takes over from here
    }

    private fun applyWaitingDark() {
        val dark = Waiting.isDark(waitingSince, waitingPeekUntil, SystemClock.uptimeMillis())
        waiting.alpha = if (dark) 0f else 1f
        setBrightness(on = !dark)
    }

    private fun setBrightness(on: Boolean) {
        window.attributes = window.attributes.apply {
            screenBrightness = if (on) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE else 0f
        }
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
            hideWaiting()
            web.visibility = View.VISIBLE
        }
    }

    /* ----- page bridge ----- */

    private fun sendKey(key: String) = web.evaluateJavascript(Keys.eventScript(key), null)

    private inner class Bridge {
        /** Dark = minimum brightness; the page draws black on top, so the AMOLED pixels are off. */
        @JavascriptInterface
        fun setScreen(on: Boolean) = runOnUiThread { setBrightness(on) }

        /** `{"level":66,"plugged":true}` as a JSON string, or "null". */
        @JavascriptInterface
        fun battery(): String {
            // A sticky broadcast: registering with no receiver just returns the latest value.
            val status = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return "null"
            return Battery.json(
                level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1),
                scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1),
                plugged = status.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0),
            )
        }
    }

    /* ----- hardware keys ----- */

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val key = Keys.forKeyCode(event.keyCode) ?: return super.dispatchKeyEvent(event)
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            // Back acts on release, like everywhere in Android; holding it opens the escape menu.
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                backHold.pressed()
                handler.postDelayed(backHeld, BackHold.HOLD_MS)
            } else if (event.action == KeyEvent.ACTION_UP) {
                handler.removeCallbacks(backHeld)
                if (backHold.released()) sendKey(key)
            }
        } else if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            sendKey(key) // repeats are dropped: the cover can hold a volume key down
        }
        return true
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasCategory(Intent.CATEGORY_HOME)) sendKey("home")
    }

    /* ----- full screen ----- */

    override fun onResume() {
        super.onResume()
        resumed = true
        hideSystemBars()
    }

    override fun onPause() {
        resumed = false
        pausedAt = SystemClock.uptimeMillis()
        super.onPause()
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

    /* ----- escape menu: hold Back ----- */

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
