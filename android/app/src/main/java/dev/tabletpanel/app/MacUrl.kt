package dev.tabletpanel.app

import java.net.URI
import java.net.URISyntaxException

/** The panel's address on the Mac, as typed in the escape menu. */
object MacUrl {
    const val DEFAULT = "http://192.168.1.62:8765/"
    private const val DEFAULT_PORT = 8765

    /** Fills in what a person leaves out ("192.168.1.62" → full URL); null if it can't be a panel address. */
    fun normalize(input: String): String? {
        val trimmed = input.trim()
        if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return null
        val withScheme = if ("://" in trimmed) trimmed else "http://$trimmed"
        val uri = try {
            URI(withScheme)
        } catch (e: URISyntaxException) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host ?: return null
        val port = if (uri.port == -1) DEFAULT_PORT else uri.port
        val path = uri.rawPath.orEmpty().ifEmpty { "/" }
        val query = uri.rawQuery?.let { "?$it" }.orEmpty()
        return "$scheme://$host:$port$path$query"
    }
}
