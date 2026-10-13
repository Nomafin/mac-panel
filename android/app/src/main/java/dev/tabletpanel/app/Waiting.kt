package dev.tabletpanel.app

/** The "Waiting for your Mac…" screen goes dark like the panel does, so it can't burn in overnight. */
object Waiting {
    const val DARK_AFTER_MS = 30_000L
    const val PEEK_MS = 60_000L

    fun isDark(waitingSince: Long, peekUntil: Long, now: Long) =
        now >= peekUntil && now - waitingSince >= DARK_AFTER_MS
}
