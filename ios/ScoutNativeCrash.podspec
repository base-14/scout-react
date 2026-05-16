require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ScoutNativeCrash'
  s.version        = package['version']
  s.summary        = 'Native crash capture (NSException) for scout-react.'
  s.description    = 'Captures uncaught NSExceptions via NSSetUncaughtExceptionHandler and persists a JSON report so scout-react can emit a native_crash span on the next launch.'
  s.license        = 'MIT'
  s.author         = package['author']
  s.homepage       = 'https://github.com/base-14/scout-react'
  s.platforms      = { :ios => '13.0' }
  s.source         = { :git => 'https://github.com/base-14/scout-react.git', :tag => "v#{s.version}" }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Production-grade crash capture: multi-thread state, registers, mach
  # exceptions, NSException + C++ exception + signal monitors, and binary
  # images for offline symbolication. Replaces our hand-rolled
  # NSSetUncaughtExceptionHandler + POSIX signal handler.
  s.dependency 'KSCrash/Recording', '~> 2.0'

  s.source_files   = '**/*.{swift,h,m}'
  # Expose the C signal-handler header so the in-pod Swift code can `import`
  # it via the auto-generated module map.
  s.public_header_files = '*.h'
end
