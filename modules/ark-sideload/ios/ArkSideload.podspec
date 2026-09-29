# ArkStore's on-iPhone installer. ios/lib/libark_sideload.a is built from sideload/ (Rust) by
# `npm run ios:sideload` (or the iOS release workflow) before `pod install`.
Pod::Spec.new do |s|
  s.name           = 'ArkSideload'
  s.version        = '1.0.0'
  s.summary        = 'Install and renew apps on the iPhone with your own Apple Account'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'Ark-Devs'
  s.homepage       = 'https://github.com/Ark-Devs/ArkStore'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Ark-Devs/ArkStore.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.{h,swift}'
  s.public_header_files = 'ark_sideload.h'
  s.vendored_libraries = 'lib/libark_sideload.a'
  s.frameworks = 'Security', 'SystemConfiguration', 'CoreFoundation'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
