Pod::Spec.new do |s|
  s.name           = 'GlassKit'
  s.version        = '1.0.0'
  s.summary        = 'Liquid Glass (UIGlassEffect, iOS 26) background view for the Authentik dock'
  s.description    = 'Native glass material for React Native: UIGlassEffect on iOS 26, thin system blur with rim light and outer shadow before.'
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
