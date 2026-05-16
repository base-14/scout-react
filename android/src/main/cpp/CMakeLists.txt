cmake_minimum_required(VERSION 3.22.1)
project(scout_signal_handler)

add_library(scout_signal_handler SHARED scout_signal_handler.c)

# unwind comes built-in on NDK r23+
target_link_libraries(scout_signal_handler log)
