package dev.tabletpanel.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KeysTest {
    @Test fun mapsKeyCodes() {
        assertEquals("back", Keys.forKeyCode(4))
        assertEquals("volumeup", Keys.forKeyCode(24))
        assertEquals("volumedown", Keys.forKeyCode(25))
        assertNull(Keys.forKeyCode(66)) // Enter stays with the WebView
    }

    @Test fun recognisesRecents() {
        assertTrue(Keys.isRecentsReason("recentapps"))
        assertFalse(Keys.isRecentsReason("homekey"))
        assertFalse(Keys.isRecentsReason(null))
    }

    @Test fun eventScript() = assertEquals(
        "window.dispatchEvent(new CustomEvent('tablet-key',{detail:{key:'back'}}))",
        Keys.eventScript("back"),
    )
}
