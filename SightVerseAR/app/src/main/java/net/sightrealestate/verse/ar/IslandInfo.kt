package net.sightrealestate.verse.ar

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Building copy + layout exported from the web app's config.js (assets/buildings.json). */
data class Fact(val value: String, val label: String)
data class Section(val heading: String, val body: String)
data class Contact(val email: String?, val phone: String?, val address: String?, val hours: String?)
data class Building(
    val id: String, val label: String, val kicker: String, val title: String, val summary: String,
    val accent: Long, val facts: List<Fact>, val sections: List<Section>, val clients: List<String>,
    val contact: Contact?, val model: String,
)
data class IslandInfo(
    val name: String, val tagline: String,
    val tabletopMetres: Float, val islandSize: Float,
    val buildings: List<Building>,
)

private fun JSONObject.str(k: String) = if (has(k) && !isNull(k)) getString(k) else ""
private fun JSONObject.strOrNull(k: String) = if (has(k) && !isNull(k)) getString(k).ifBlank { null } else null
private inline fun <T> JSONArray?.mapObjects(f: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else (0 until length()).map { f(getJSONObject(it)) }

private fun parseColor(hex: String): Long =
    runCatching { 0xFF000000L or hex.removePrefix("#").toLong(16) }.getOrDefault(0xFF7DD3FC)

fun loadIslandInfo(ctx: Context): IslandInfo {
    val root = JSONObject(ctx.assets.open("buildings.json").bufferedReader().use { it.readText() })
    val company = root.getJSONObject("company")
    val buildings = root.getJSONArray("buildings").mapObjects { b ->
        val c = b.optJSONObject("contact")
        Building(
            id = b.str("id"), label = b.str("label"), kicker = b.str("kicker"), title = b.str("title"),
            summary = b.str("summary"), accent = parseColor(b.str("accent")),
            facts = b.optJSONArray("facts").mapObjects { Fact(it.str("value"), it.str("label")) },
            sections = b.optJSONArray("sections").mapObjects { Section(it.str("heading"), it.str("body")) },
            clients = b.optJSONArray("clients")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList(),
            contact = c?.let { Contact(it.strOrNull("email"), it.strOrNull("phone"), it.strOrNull("address"), it.strOrNull("hours")) },
            model = b.str("model"),
        )
    }
    return IslandInfo(
        name = company.str("name"), tagline = company.str("tagline"),
        tabletopMetres = root.optDouble("tabletopMetres", 1.3).toFloat(),
        islandSize = root.optDouble("islandSize", 760.0).toFloat(),
        buildings = buildings,
    )
}
