// Standalone JVM project: the scout-react Android library itself cannot be
// built in isolation (it depends on :expo-modules-core, which only exists
// inside a host app's Gradle build). This project compiles the Android-free
// decision cores from ../src/main/java and runs their JUnit tests, so CI can
// verify them with nothing but a JDK.
rootProject.name = "scout-react-unit-tests"
