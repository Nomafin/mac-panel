package dev.tabletpanel.app

/** Back: a short press goes to the page; holding it opens the escape menu instead. */
class BackHold {
    companion object {
        const val HOLD_MS = 1500L
    }

    private var down = false
    private var menuOpened = false

    fun pressed() {
        down = true
        menuOpened = false
    }

    /** The hold timer fired. True = open the menu now. */
    fun heldLongEnough(): Boolean {
        if (!down) return false
        menuOpened = true
        return true
    }

    /** True = send an ordinary Back to the page. */
    fun released(): Boolean {
        down = false
        return !menuOpened
    }
}
