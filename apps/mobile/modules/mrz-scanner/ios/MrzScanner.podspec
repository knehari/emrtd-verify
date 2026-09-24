Pod::Spec.new do |s|
  s.name           = 'MrzScanner'
  s.version        = '1.0.0'
  s.summary        = 'Live MRZ text recognition (AVFoundation + Apple Vision) for Authentik'
  s.description    = 'Camera preview view that runs VNRecognizeTextRequest on video frames and reports recognized lines to JS.'
  s.author         = 'Authentik'
  s.homepage       = 'https://github.com/knehari/emrtd-verify'
  s.license        = { :type => 'Apache-2.0' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
