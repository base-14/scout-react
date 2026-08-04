plugins {
  kotlin("jvm") version "2.0.21"
}

repositories {
  mavenCentral()
}

kotlin {
  jvmToolchain(17)
}

// Compile only the classes that carry no Android dependency. Everything else
// in the module needs android.jar / expo-modules-core and is covered by the
// on-device checks instead.
sourceSets {
  main {
    kotlin {
      setSrcDirs(listOf("../src/main/java"))
      include(
        "io/base14/scoutreact/ScoutExitInfoClassifier.kt",
        "io/base14/scoutreact/ScoutHangDetector.kt",
      )
    }
  }
}

dependencies {
  testImplementation(kotlin("test"))
  testImplementation("junit:junit:4.13.2")
}

tasks.test {
  useJUnit()
  testLogging {
    events("passed", "failed", "skipped")
  }
}
