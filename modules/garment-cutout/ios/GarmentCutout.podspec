Pod::Spec.new do |s|
  s.name           = 'GarmentCutout'
  s.version        = '1.0.0'
  s.summary        = 'On-device garment background removal'
  s.description    = 'Cuts a garment out of a photo with Vision foreground instance masks (iOS 17+).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  # Matches Expo SDK 58's minimum (ExpoModulesCore); the Vision call is gated on iOS 17 at runtime.
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'CoreImage', 'ImageIO', 'UniformTypeIdentifiers'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
