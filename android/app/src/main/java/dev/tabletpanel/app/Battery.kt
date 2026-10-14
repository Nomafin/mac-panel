package dev.tabletpanel.app

/** The tablet's battery for the page, which can't read it itself (no Battery API in this WebView). */
object Battery {
    /** Values from Android's sticky battery broadcast; `null` when Android has no reading. */
    fun json(level: Int, scale: Int, plugged: Int): String {
        if (level < 0 || scale <= 0) return "null"
        val percent = Math.round(level * 100f / scale)
        return """{"level":$percent,"plugged":${plugged != 0}}"""
    }
}
