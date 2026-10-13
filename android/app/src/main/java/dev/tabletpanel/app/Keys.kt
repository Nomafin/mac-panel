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

    fun eventScript(key: String) = "window.dispatchEvent(new CustomEvent('tablet-key',{detail:{key:'$key'}}))"
}
