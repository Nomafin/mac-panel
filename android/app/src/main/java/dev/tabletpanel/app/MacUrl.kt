package dev.tabletpanel.app

import java.net.URI
import java.net.URISyntaxException

/** The panel's address on the Mac, as typed in the escape menu. */
object MacUrl {
    private const val DEFAULT_PORT = 8765

    /** The saved address to load at start, or null when the address still needs to be set. */
    fun startUrl(saved: String?): String? = saved?.let { normalize(it) }

    /** Fills in what a person leaves out ("192.168.1.20" → full URL); null if it can't be a panel address. */
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
