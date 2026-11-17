cmake_minimum_required(VERSION 3.22.1)
project(scout_signal_handler)

add_library(scout_signal_handler SHARED scout_signal_handler.c)

# unwind comes built-in on NDK r23+
target_link_libraries(scout_signal_handler log)

# Google Play requires 16 KB page alignment for apps targeting Android 15+.
# NDK r28+ does this by default; r27 (the React Native default) does not.
target_link_options(scout_signal_handler PRIVATE "-Wl,-z,max-page-size=16384")
