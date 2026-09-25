Pod::Spec.new do |s|
  s.name           = 'FaceKit'
  s.version        = '1.0.0'
  s.summary        = 'Face detection (Apple Vision) and front-camera capture for Authentik face matching'
  s.description    = 'Detects faces and 5 landmarks in the DG2 chip photo and in a live front-camera feed, and returns aligned-ready RGB crops to JS.'
  s.author         = 'Authentik'
  s.homepage       = 'https://github.com/knehari/emrtd-verify'
  s.license        = { :type => 'Apache-2.0' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ARKit', 'SceneKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
