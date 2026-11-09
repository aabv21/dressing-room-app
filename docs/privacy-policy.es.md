# Política de privacidad de Dressing Room

[English](privacy-policy.md)

Última actualización: 9 de noviembre de 2026

Dressing Room es una app de clóset digital: fotografías tu ropa y la app te sugiere outfits,
califica los outfits que armas y lleva la cuenta de lo que usas. Esta página explica qué datos
recoge la app, dónde se guardan, quién los procesa y cómo puedes exportarlos o eliminarlos. Las
preguntas van a `<owner email>`.

## Qué datos recoge la app

- **Tu cuenta.** Tu correo electrónico y una contraseña, que Supabase Auth guarda solo como hash.
  Si entras con Apple o con Google, la app recibe el token de identidad que ese servicio emite para
  ti (con tu correo, o la dirección privada de reenvío de Apple si elegiste ocultarlo). Con Iniciar
  sesión con Apple, el servidor guarda además un token de actualización, que se usa solo para
  revocar el acceso de la app cuando eliminas tu cuenta.
- **Tu perfil.** El tipo de ropa que usas (femenina, masculina o de todo un poco) y, solo si los
  indicas: tu tipo de cuerpo, tu estatura, tus medidas de pecho, cintura y cadera, tus tallas de ropa
  y de calzado, tu rango de edad, los estilos y ocasiones que te gustan, tu ciudad y tu idioma. Tu
  peso nunca se pide.
- **Tu ciudad.** Puedes escribirla, o dejar que la app lea tu ubicación una vez para encontrarla. La
  app pide acceso a la ubicación solo mientras la usas, y guarda el nombre de la ciudad y sus
  coordenadas redondeadas a dos decimales (alrededor de 1 km), nunca tu posición exacta. El propio
  sistema de tu teléfono convierte la ubicación en el nombre de la ciudad.
- **Fotos de tu ropa.** Antes de que una foto salga de tu teléfono, la app le quita el fondo en el
  propio dispositivo (cuando el teléfono lo permite) y la reduce a un máximo de 784 píxeles, más una
  miniatura de 256 píxeles. Solo se suben esas dos versiones. La app no guarda nada en tu galería ni
  lee de ella más que las fotos que eliges.
- **Tu clóset.** Los atributos de cada prenda (categoría, colores, estampado, material, formalidad,
  temporadas, abrigo, corte, ocasiones), su estado (disponible, en la lavandería, en préstamo o
  donada) y cuántas veces la usas.
- **Lo que usas.** Los outfits que guardas o registras como usados, con el día, la ocasión y el
  puntaje.
- **Conteos de uso.** Cuántas solicitudes de IA de cada tipo hiciste cada día, para aplicar los
  límites diarios, y los resultados de solicitudes recientes, para que repetir una no cueste nada.

La app no tiene publicidad, ni analítica, ni rastreo, y tus datos nunca se venden.

## Dónde se guardan

Todo lo anterior se guarda en un proyecto de [Supabase](https://supabase.com): la base de datos, el
servicio de inicio de sesión y un espacio privado para las fotos. Supabase también envía a tu correo
la confirmación de registro y los códigos para restablecer la contraseña, a través del servicio de
correo configurado para el proyecto. Cada fila y cada foto pertenecen a tu cuenta, y las reglas de
seguridad de la base de datos solo permiten que tu cuenta, con tu sesión iniciada, las lea o las
cambie. La app se comunica con Supabase por conexiones cifradas y no guarda ninguna otra clave.

Tu teléfono guarda además una copia de tu clóset, las sugerencias de outfit del día, tus últimas
ideas de "Para ti" y fotos en caché, para que la app funcione sin conexión. Una foto que espera para
subirse se guarda en la carpeta propia de la app hasta que se sube.

## Quién los procesa

| Proveedor | Qué recibe | Para qué |
|---|---|---|
| Supabase | Todo lo anterior | Alojamiento: la base de datos, el inicio de sesión, el almacenamiento de fotos y las funciones del servidor que llaman a los servicios de abajo |
| Anthropic (Claude) | Por cada prenda nueva, su foto preparada (sin fondo y de 784 píxeles como máximo) y el tipo de ropa que elegiste. Cuando el servicio de calificación no está disponible, el mismo resumen anónimo que recibe TypeSafe. Para "Para ti", solo descripciones genéricas de las prendas sugeridas, con cuántas de tus prendas y outfits combina cada una, y el idioma de la app (inglés o español) en que escribir las frases, sin nada más sobre ti. | Reconocer los atributos de cada prenda; una calificación de respaldo; las frases cortas de las tarjetas de "Para ti" |
| TypeSafe (Jev) | Solo un resumen anónimo: tu tipo de ropa, tipo de cuerpo, un rango de estatura (baja, media o alta), rango de edad y estilos; la ocasión, el clima y la temporada; y la categoría, los colores, el estampado, la formalidad y el corte de cada prenda. Nunca una foto, una medida exacta, una talla, tu nombre ni tu correo. | Calificar outfits y ordenar sugerencias |
| Open-Meteo | Las coordenadas de tu ciudad, o el nombre de la ciudad cuando no las hay | El clima del día |
| Apple | Tu identidad de Iniciar sesión con Apple y, cuando eliminas tu cuenta, una solicitud para revocar el acceso de la app | El inicio de sesión, y cortar ese vínculo cuando te vas |
| Google | Tu identidad de Iniciar sesión con Google | El inicio de sesión |
| Amazon SES | Tu correo electrónico y el código de confirmación o para restablecer la contraseña | Enviar los correos de tu cuenta |

Los servicios de IA reciben estas solicitudes desde el servidor de la app, nunca directamente desde
tu teléfono, y el servidor nunca les envía tus fotos salvo para el reconocimiento de prendas descrito
arriba. Cuando tocas "Buscar en tiendas" en una idea de "Para ti", tu navegador abre una búsqueda de
Google con palabras genéricas como "blazer camel mujer"; a esa búsqueda se aplica la política de
privacidad de Google.

## Cuánto tiempo se guardan

Tus datos se guardan hasta que los eliminas o eliminas tu cuenta. Puedes eliminar cualquier prenda
(sus fotos también se borran) o cualquier uso registrado cuando quieras. El dueño de la app guarda
cada noche una copia de seguridad de la base de datos y las fotos en su propia computadora, solo para
recuperación, y conserva las 14 más recientes; los datos que eliminas desaparecen de las copias de
seguridad después de las 14 copias nocturnas siguientes (unas dos semanas cuando se hacen todas las
noches).

Cada proveedor de arriba aplica sus propias reglas de conservación a lo que recibe de la app.

## Tus opciones: exportar y eliminar

- **Exportar.** Perfil → Privacidad → "Exportar mis datos" te da un archivo con tu perfil, tus
  prendas, tus outfits y tus usos, más enlaces a tus fotos que funcionan durante 7 días.
- **Eliminar tu cuenta.** Perfil → Privacidad → "Eliminar cuenta", confirmado dos veces, borra tus
  fotos, revoca Iniciar sesión con Apple si lo usaste, y elimina tu cuenta y cada fila que le
  pertenece. Después la app borra su copia de tus datos en ese teléfono y cierra tu sesión.

También puedes cambiar o borrar cualquier dato de tu perfil cuando quieras en la pestaña Perfil, y
elegir no dar tu ciudad ni tus datos corporales.

## Cambios y contacto

Si esta política cambia, la nueva versión se publicará en esta página con una fecha nueva. Para
cualquier pregunta, o para pedir tus datos o su eliminación, escribe a `<owner email>`.
