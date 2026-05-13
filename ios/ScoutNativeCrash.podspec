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

  s.source_files   = '**/*.{swift,h,m}'
end
