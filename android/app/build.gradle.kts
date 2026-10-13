import java.util.Properties

plugins {
    id("com.android.application")
}

// Ключ загрузки для Google Play: android/.build/release/keystore.properties (вне git,
// создаётся android/make-upload-key.sh). Нет файла — release-сборка не подписывается
val releaseProps = Properties().apply {
    val f = rootProject.file(".build/release/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.rockman.tanglo"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.rockman.tanglo"
        minSdk = 24
        targetSdk = 36
        versionCode = 2
        versionName = "1.0.1"
    }

    signingConfigs {
        if (releaseProps.containsKey("storeFile")) {
            create("release") {
                storeFile = rootProject.file(releaseProps.getProperty("storeFile"))
                storePassword = releaseProps.getProperty("storePassword")
                keyAlias = releaseProps.getProperty("keyAlias")
                keyPassword = releaseProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

}
