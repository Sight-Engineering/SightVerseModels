package net.sightrealestate.verse.ar

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.ar.core.Anchor
import com.google.ar.core.Config
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.TrackingState
import io.github.sceneview.ar.ARSceneView
import io.github.sceneview.math.Rotation
import io.github.sceneview.math.Scale
import io.github.sceneview.node.Node
import io.github.sceneview.rememberEngine
import io.github.sceneview.rememberModelInstance
import io.github.sceneview.rememberModelLoader
import io.github.sceneview.rememberOnGestureListener

private val Ink = Color(0xFFE8EEF3)
private val InkDim = Color(0xFFA9B6C2)
private val Glass = Color(0xE60A1218)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val info = loadIslandInfo(this)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFF7DD3FC))) {
                IslandAR(info)
            }
        }
    }
}

/** Walks up from a tapped node to the building it belongs to (ModelNodes are named "building:<id>"). */
private fun buildingIdOf(node: Node?): String? {
    var n = node
    while (n != null) {
        n.name?.takeIf { it.startsWith("building:") }?.let { return it.removePrefix("building:") }
        n = n.parent
    }
    return null
}

@Composable
fun IslandAR(info: IslandInfo) {
    val engine = rememberEngine()
    val modelLoader = rememberModelLoader(engine)
    val lastFrame = remember { arrayOfNulls<Frame>(1) }          // not state: updated every AR frame
    var surfaceFound by remember { mutableStateOf(false) }
    var anchor by remember { mutableStateOf<Anchor?>(null) }
    var yaw by remember { mutableFloatStateOf(0f) }                // degrees, one-finger drag
    var zoom by remember { mutableFloatStateOf(1f) }               // pinch multiplier
    var selected by remember { mutableStateOf<Building?>(null) }
    val baseScale = info.tabletopMetres / info.islandSize            // island metres -> real metres

    fun placeAt(x: Float, y: Float) {
        val frame = lastFrame[0] ?: return
        val hit = frame.hitTest(x, y).firstOrNull { h ->
            val t = h.trackable
            t is Plane && t.isPoseInPolygon(h.hitPose) && t.type == Plane.Type.HORIZONTAL_UPWARD_FACING
        } ?: return
        anchor?.detach()
        anchor = hit.createAnchor()
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        ARSceneView(
            modifier = Modifier.fillMaxSize(),
            engine = engine,
            modelLoader = modelLoader,
            planeFindingMode = Config.PlaneFindingMode.HORIZONTAL,
            planeRenderer = anchor == null,
            onSessionUpdated = { session, frame ->
                lastFrame[0] = frame
                if (!surfaceFound && session.getAllTrackables(Plane::class.java).any { it.trackingState == TrackingState.TRACKING }) {
                    surfaceFound = true
                }
            },
            onGestureListener = rememberOnGestureListener(
                onSingleTapConfirmed = { e, node ->
                    val id = buildingIdOf(node)
                    if (id != null) selected = info.buildings.firstOrNull { it.id == id }
                    else if (selected == null) placeAt(e.x, e.y)
                    else selected = null
                },
                onScroll = { _, _, _, distance -> if (anchor != null) yaw -= distance.x * 0.3f },
                onScale = { detector, _, _ -> zoom = (zoom * detector.scaleFactor).coerceIn(0.35f, 3f) },
            ),
        ) {
            anchor?.let { a ->
                AnchorNode(anchor = a) {
                    Node(rotation = Rotation(y = yaw), scale = Scale(baseScale * zoom)) {
                        rememberModelInstance(modelLoader, "base.glb")?.let { ModelNode(modelInstance = it) }
                        info.buildings.forEach { b ->
                            key(b.id) {
                                rememberModelInstance(modelLoader, b.model)?.let {
                                    ModelNode(modelInstance = it, apply = { name = "building:${b.id}" })
                                }
                            }
                        }
                    }
                }
            }
        }

        // ---------------------------------------------------------------- top bar: hint + reset
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                when {
                    anchor != null -> "Drag to turn · pinch to resize · tap a building"
                    surfaceFound -> "Tap the grid to place the island"
                    else -> "Move your phone slowly to find a table or floor"
                },
                color = Ink, fontSize = 13.sp,
                modifier = Modifier.weight(1f).background(Glass, RoundedCornerShape(50)).padding(horizontal = 16.dp, vertical = 10.dp),
            )
            if (anchor != null) {
                Spacer(Modifier.width(8.dp))
                TextButton(
                    onClick = { anchor?.detach(); anchor = null; selected = null; yaw = 0f; zoom = 1f },
                    colors = ButtonDefaults.textButtonColors(containerColor = Glass, contentColor = Ink),
                ) { Text("Reset") }
            }
        }

        // ---------------------------------------------------------------- building panel
        AnimatedVisibility(
            visible = selected != null,
            modifier = Modifier.align(Alignment.BottomCenter),
            enter = slideInVertically { it }, exit = slideOutVertically { it },
        ) {
            selected?.let { b ->
                BuildingPanel(
                    b,
                    onClose = { selected = null },
                    onStep = { d ->
                        val i = info.buildings.indexOf(b)
                        selected = info.buildings[(i + d + info.buildings.size) % info.buildings.size]
                    },
                )
            }
        }
    }
}

@Composable
private fun BuildingPanel(b: Building, onClose: () -> Unit, onStep: (Int) -> Unit) {
    val ctx = LocalContext.current
    val accent = Color(b.accent)
    fun open(uri: String, action: String = Intent.ACTION_VIEW) =
        runCatching { ctx.startActivity(Intent(action, Uri.parse(uri))) }

    Column(
        Modifier.fillMaxWidth().heightIn(max = 460.dp)
            .background(Glass, RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
            .navigationBarsPadding().padding(20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(b.kicker.uppercase(), color = accent, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp, modifier = Modifier.weight(1f))
            TextButton(onClick = { onStep(-1) }) { Text("←", color = Ink) }
            TextButton(onClick = { onStep(1) }) { Text("→", color = Ink) }
            TextButton(onClick = onClose) { Text("✕", color = Ink) }
        }
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Text(b.title, color = Ink, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, lineHeight = 28.sp)
            Spacer(Modifier.height(8.dp))
            Text(b.summary, color = InkDim, fontSize = 14.sp, lineHeight = 21.sp)
            if (b.facts.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    b.facts.take(3).forEach { f ->
                        Column(Modifier.weight(1f).background(Color(0x14FFFFFF), RoundedCornerShape(12.dp)).padding(10.dp)) {
                            Text(f.value, color = accent, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            Text(f.label, color = InkDim, fontSize = 11.sp)
                        }
                    }
                }
            }
            b.sections.forEach { s ->
                Spacer(Modifier.height(14.dp))
                Text(s.heading, color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Text(s.body, color = InkDim, fontSize = 14.sp, lineHeight = 21.sp)
            }
            if (b.clients.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                Text(b.clients.joinToString("  ·  "), color = InkDim, fontSize = 13.sp)
            }
            b.contact?.let { c ->
                Spacer(Modifier.height(14.dp))
                c.email?.let { ContactRow("Email", it) { open("mailto:$it", Intent.ACTION_SENDTO) } }
                c.phone?.let { p -> ContactRow("Phone", p) { open("tel:" + p.filter { ch -> ch.isDigit() || ch == '+' }, Intent.ACTION_DIAL) } }
                c.address?.let { ContactRow("Address", it) { open("geo:0,0?q=" + Uri.encode(it)) } }
                c.hours?.let { ContactRow("Hours", it, null) }
            }
        }
    }
}

@Composable
private fun ContactRow(label: String, value: String, onClick: (() -> Unit)?) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 4.dp)
            .background(Color(0x14FFFFFF), RoundedCornerShape(12.dp))
            .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier)
            .padding(12.dp),
    ) {
        Text(label, color = InkDim, fontSize = 11.sp)
        Text(value, color = Ink, fontSize = 14.sp)
    }
}
