package dev.tabletpanel.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackHoldTest {
    @Test fun aShortPressIsAnOrdinaryBack() {
        val hold = BackHold()
        hold.pressed()
        assertTrue(hold.released())
    }

    @Test fun aLongPressOpensTheMenuInsteadOfGoingBack() {
        val hold = BackHold()
        hold.pressed()
        assertTrue(hold.heldLongEnough())
        assertFalse(hold.released())
    }

    @Test fun theNextPressStartsAfresh() {
        val hold = BackHold()
        hold.pressed(); hold.heldLongEnough(); hold.released()
        hold.pressed()
        assertTrue(hold.released())
    }

    @Test fun aStaleTimerAfterReleaseDoesNothing() {
        val hold = BackHold()
        hold.pressed(); hold.released()
        assertFalse(hold.heldLongEnough())
    }
}
