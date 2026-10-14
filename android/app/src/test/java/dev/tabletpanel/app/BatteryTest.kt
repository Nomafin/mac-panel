package dev.tabletpanel.app

import org.junit.Assert.assertEquals
import org.junit.Test

class BatteryTest {
    @Test fun reportsPercentAndCharger() =
        assertEquals("""{"level":66,"plugged":true}""", Battery.json(level = 66, scale = 100, plugged = 1))

    @Test fun scalesOddScales() =
        assertEquals("""{"level":50,"plugged":false}""", Battery.json(level = 25, scale = 50, plugged = 0))

    @Test fun unknownWhenAndroidHasNoReading() =
        assertEquals("null", Battery.json(level = -1, scale = -1, plugged = 0))
}
