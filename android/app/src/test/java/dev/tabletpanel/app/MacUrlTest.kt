package dev.tabletpanel.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MacUrlTest {
    @Test fun addsSchemePortAndSlash() = assertEquals("http://192.168.1.62:8765/", MacUrl.normalize("192.168.1.62"))
    @Test fun keepsGivenPort() = assertEquals("http://mac.local:9000/", MacUrl.normalize("http://mac.local:9000"))
    @Test fun keepsPathAndQueryAndTrims() = assertEquals("http://h:1/x?mock", MacUrl.normalize("  http://h:1/x?mock "))
    @Test fun lowercasesScheme() = assertEquals("https://h:8765/", MacUrl.normalize("HTTPS://h"))
    @Test fun rejectsOtherSchemes() = assertNull(MacUrl.normalize("ftp://h"))
    @Test fun rejectsEmpty() = assertNull(MacUrl.normalize("   "))
    @Test fun rejectsMissingHost() = assertNull(MacUrl.normalize("http://"))
    @Test fun rejectsSpaces() = assertNull(MacUrl.normalize("my mac"))
    @Test fun defaultIsNormal() = assertEquals(MacUrl.DEFAULT, MacUrl.normalize(MacUrl.DEFAULT))
}
