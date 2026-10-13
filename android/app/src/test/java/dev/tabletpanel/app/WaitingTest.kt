package dev.tabletpanel.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WaitingTest {
    @Test fun litForTheFirst30Seconds() {
        assertFalse(Waiting.isDark(waitingSince = 1000, peekUntil = 0, now = 30_999))
        assertTrue(Waiting.isDark(waitingSince = 1000, peekUntil = 0, now = 31_000))
    }

    @Test fun aTapLightsItForAMinute() {
        assertFalse(Waiting.isDark(waitingSince = 0, peekUntil = 100_000, now = 99_999))
        assertTrue(Waiting.isDark(waitingSince = 0, peekUntil = 100_000, now = 100_000))
    }
}
