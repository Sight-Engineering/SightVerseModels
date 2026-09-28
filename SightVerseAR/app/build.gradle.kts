import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// signing secrets live outside git: keystore.properties next to this project (see README)
val keyProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "net.sightrealestate.verse.ar"
    compileSdk = 36

    defaultConfig {
        applicationId = "net.sightrealestate.verse.ar"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            if (keyProps.isNotEmpty()) {
                storeFile = file(keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    // .glb files must stay uncompressed in the APK so Filament can memory-map them
    androidResources { noCompress += listOf("glb", "filamat", "ktx") }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
}

kotlin { jvmToolchain(17) }

val sceneviewSources by configurations.creating

dependencies {
    implementation("io.github.sceneview:arsceneview:4.42.0")
    implementation(platform("androidx.compose:compose-bom:2025.09.00"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("org.json:json:20240303")
    sceneviewSources("io.github.sceneview:arsceneview:4.42.0:sources")
    sceneviewSources("io.github.sceneview:sceneview:4.42.0:sources")
}

// dev helper: unpack the SceneView sources to build/sv-src so the API can be read
tasks.register<Copy>("unpackSceneviewSources") {
    from(sceneviewSources.map { zipTree(it) })
    into(layout.buildDirectory.dir("sv-src"))
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}
