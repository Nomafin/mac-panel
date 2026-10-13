package dev.tabletpanel.app

import android.view.KeyEvent

/** Hardware keys the panel page hears about, as `tablet-key` DOM events. */
object Keys {
    fun forKeyCode(code: Int): String? = when (code) {
        KeyEvent.KEYCODE_BACK -> "back"
        KeyEvent.KEYCODE_VOLUME_UP -> "volumeup"
        KeyEvent.KEYCODE_VOLUME_DOWN -> "volumedown"
        else -> null
    }

    /** Android 7 announces the Recents key to apps as "close system dialogs" with this reason. */
    fun isRecentsReason(reason: String?) = reason == "recentapps"

    /**
     * Recents pulls the panel back only if it was in front. The broadcast can arrive just after
     * onPause, hence the grace period; otherwise another app (e.g. the Samsung launcher) is in use.
     */
    fun shouldBounce(resumed: Boolean, pausedAt: Long, now: Long) = resumed || now - pausedAt < BOUNCE_GRACE_MS

    private const val BOUNCE_GRACE_MS = 1000L

    fun eventScript(key: String) = "window.dispatchEvent(new CustomEvent('tablet-key',{detail:{key:'$key'}}))"
}
