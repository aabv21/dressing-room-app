import type { MessageKey } from './index';

export const es: Record<MessageKey, string> = {
  'tabs.today': 'Hoy',
  'tabs.closet': 'Clóset',
  'tabs.build': 'Armar',
  'tabs.forYou': 'Para ti',
  'tabs.profile': 'Perfil',

  'wear.never': 'sin usar',
  'wear.one': '{count} uso',
  'wear.other': '{count} usos',

  'grid.empty': 'Agrega tus {count} favoritas para empezar.',
  'grid.loadError': 'No se pudo cargar la foto',

  'closet.gallery': 'Galería',
  'closet.burstMode': 'Modo ráfaga',

  'screen.today': 'HOY',
  'screen.closet': 'TU CLÓSET',
  'screen.build': 'ARMAR OUTFIT',
  'screen.forYou': 'PARA TI',
  'screen.profile': 'PERFIL',

  comingSoon: 'Llega en la próxima etapa.',

  'perf.hud': '{frames} frames · {dropped} dropped ({ratio}%)\np95 {p95} ms · median {median} ms ≈ {hz} Hz',
  'perf.cacheCleared': 'Caché de imágenes vaciada · estadísticas reiniciadas',
  'perf.cacheClearFailed': 'No se pudo vaciar la caché de imágenes',

  'auth.welcome.title': 'VÍSTETE\nSIN DUDAR',
  'auth.welcome.subtitle': 'Tu clóset en el bolsillo y una IA que te dice qué tan bien se ve.',
  'auth.welcome.cta': 'Crear cuenta',
  'auth.social.apple': 'Continuar con Apple',
  'auth.social.google': 'Continuar con Google',
  'auth.divider.email': 'o con tu correo',
  'auth.field.email': 'Correo',
  'auth.field.emailPlaceholder': 'correo@ejemplo.com',
  'auth.field.password': 'Contraseña',
  'auth.field.passwordPlaceholder': 'Contraseña',
  'auth.forgotPassword': '¿Olvidaste tu contraseña?',
  'auth.haveAccount': 'Ya tengo cuenta',

  'auth.signIn.title': 'HOLA DE NUEVO',
  'auth.signIn.subtitle': 'Entra para continuar donde lo dejaste.',
  'auth.signIn.cta': 'Entrar',
  'auth.signIn.noAccount': 'Crear una cuenta',
  'auth.checkEmail': 'Revisa tu correo para confirmar tu cuenta antes de entrar.',

  'auth.forgotPassword.title': 'RESTABLECE TU CONTRASEÑA',
  'auth.forgotPassword.step1.subtitle': 'Te enviaremos un código de 6 dígitos a tu correo.',
  'auth.forgotPassword.sendCode': 'Enviar código',
  'auth.forgotPassword.step2.subtitle': 'Ingresa el código y elige una nueva contraseña.',
  'auth.field.code': 'Código',
  'auth.field.codePlaceholder': 'código de 6 dígitos',
  'auth.field.newPassword': 'Nueva contraseña',
  'auth.field.newPasswordPlaceholder': 'Nueva contraseña',
  'auth.field.confirmPassword': 'Confirmar contraseña',
  'auth.field.confirmPasswordPlaceholder': 'Confirmar contraseña',
  'auth.forgotPassword.confirm': 'Confirmar',
  'auth.forgotPassword.resendCode': 'Enviar un nuevo código',
  'auth.forgotPassword.codeSent': 'Un nuevo código va en camino.',
  'auth.forgotPassword.backToEmail': 'Cambiar correo',
  'auth.forgotPassword.backToSignIn': 'Volver a entrar',

  'auth.error.invalidCredentials': 'Ese correo o contraseña no coinciden.',
  'auth.error.emailInUse': 'Ese correo ya está en uso.',
  'auth.error.weakPassword': 'Usa al menos 8 caracteres.',
  'auth.error.invalidCode': 'Ese código no es válido o ya venció.',
  'auth.error.invalidCodeFormat': 'Ingresa el código de 6 dígitos.',
  'auth.error.rateLimited': 'Demasiados intentos. Intenta de nuevo en un momento.',
  'auth.error.network': 'No se pudo conectar. Revisa tu internet e intenta de nuevo.',
  'auth.error.cancelled': 'Se canceló el inicio de sesión.',
  'auth.error.unknown': 'Algo salió mal. Intenta de nuevo.',
  'auth.error.passwordMismatch': 'Las contraseñas no coinciden.',
  'auth.error.emailRequired': 'Ingresa tu correo.',
  'auth.error.emailInvalid': 'Ingresa un correo válido.',

  'auth.language.es': 'ES',
  'auth.language.en': 'EN',
  'auth.language.labelEs': 'Español',
  'auth.language.labelEn': 'English',

  'auth.password.show': 'Mostrar contraseña',
  'auth.password.hide': 'Ocultar contraseña',

  'auth.back': 'Atrás',

  'auth.signOut': 'Cerrar sesión',
};
