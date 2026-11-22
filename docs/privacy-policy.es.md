# Política de privacidad de Dressing Room

[English](privacy-policy.md)

Última actualización: 21 de noviembre de 2026

Dressing Room es una app de clóset digital: fotografías tu ropa y la app te sugiere outfits,
califica los outfits que armas y lleva la cuenta de lo que usas. Esta página explica qué datos
recoge la app, dónde se guardan, quién los procesa y cómo puedes exportarlos o eliminarlos. Las
preguntas van a [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com).

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
- **Fotos de "¿Lo compro?".** Una foto o captura de una prenda que piensas comprar se prepara igual
  en tu teléfono y se envía a Anthropic para analizarla; luego se compara con tu clóset. Ni la app
  ni su servidor guardan la foto ni la respuesta; Anthropic trata la foto según sus propias reglas
  de conservación (ver "Cuánto tiempo se guardan"). Solo si tocas "Agregar a mi clóset" se sube,
  como cualquier foto de una prenda.
- **Tu clóset.** Los atributos de cada prenda (categoría, colores, estampado, material, formalidad,
  temporadas, abrigo, corte, ocasiones), su estado (disponible, en la lavandería, en préstamo o
  donada), cuántas veces la usas, si la sacaste de las sugerencias y, solo si lo escribes, cuánto
  pagaste por ella y en qué moneda (para mostrar su costo por uso).
- **Lo que usas.** Los outfits que guardas o registras como usados, con el día, la ocasión y el
  puntaje.
- **Tus planes y viajes.** El outfit que planeaste para un día, hasta catorce días antes (sus
  prendas y la ocasión); un plan se borra solo 30 días después de su día. También los viajes que guardas desde "Armar la maleta": la ciudad de destino, las
  fechas, la ocasión y los outfits y la lista para empacar que se mostraron. Un viaje que no
  guardas no se almacena.
- **Lo que no quieres que te sugiera.** Las combinaciones de outfit que marcaste con "No es para
  mí", para no sugerirlas de nuevo.
- **Tu voz, solo cuando tocas un micrófono.** Dictar una ciudad o la ocasión de Hoy usa el
  micrófono solo durante esa sesión (tocas para empezar y vuelves a tocar o haces una pausa para
  terminar); la app nunca graba ni guarda el audio. El reconocedor de voz de tu propio teléfono lo
  convierte en texto: en un iPhone que lo permite, todo dentro del teléfono; si no, el de Apple
  (iPhone) o el servicio de voz del teléfono, normalmente el de Google (Android), puede recibir el
  audio para transcribirlo, con sus propias condiciones de privacidad. A la app solo llegan las
  palabras resultantes, y usa una ciudad o una ocasión dictadas igual que una ciudad escrita o una
  ocasión tocada.
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

Tu teléfono guarda además una copia de tu clóset, las sugerencias de outfit del día, tus outfits
guardados, tus outfits planeados, las prendas que marcaste como empacadas en cada viaje, las
combinaciones que marcaste con "No es para mí", tus últimas ideas de "Para ti" y
fotos en caché, para que la app funcione sin conexión. Una foto que espera para
subirse se guarda en la carpeta propia de la app hasta que se sube. Si activas el recordatorio
diario, su hora se queda en tu teléfono y el propio teléfono programa la notificación (un día que
planeaste, nombra las prendas planeadas): nada de eso
llega a un servidor ni a un servicio de notificaciones push. "Escuchar" lee el texto de la
pantalla con las voces de texto a voz de tu propio teléfono.

## Quién los procesa

| Proveedor | Qué recibe | Para qué |
|---|---|---|
| Supabase | Todo lo anterior | Alojamiento: la base de datos, el inicio de sesión, el almacenamiento de fotos y las funciones del servidor que llaman a los servicios de abajo |
| Anthropic (Claude) | Por cada prenda nueva, su foto preparada (sin fondo y de 784 píxeles como máximo) y el tipo de ropa que elegiste. Cuando el servicio de calificación no está disponible, el mismo resumen anónimo que recibe TypeSafe. Para "Para ti", solo descripciones genéricas de las prendas sugeridas, con cuántas de tus prendas y outfits combina cada una, y el idioma de la app (inglés o español) en que escribir las frases, sin nada más sobre ti. Para "¿Lo compro?", la foto que tomas o eliges (preparada igual) y tu tipo de ropa; ni la app ni su servidor guardan la foto ni la respuesta, y Anthropic la trata según sus propias reglas de conservación. | Reconocer los atributos de cada prenda; una calificación de respaldo; las frases cortas de las tarjetas de "Para ti"; reconocer una prenda que piensas comprar |
| TypeSafe (Jev) | Solo un resumen anónimo: tu tipo de ropa, tipo de cuerpo, un rango de estatura (baja, media o alta), rango de edad y estilos; la ocasión, el clima y la temporada; y la categoría, los colores, el estampado, la formalidad y el corte de cada prenda. Nunca una foto, una medida exacta, una talla, tu nombre ni tu correo. | Calificar outfits y ordenar sugerencias |
| Open-Meteo | Las coordenadas de tu ciudad, o el nombre de la ciudad cuando no las hay; para "Armar la maleta", el nombre de la ciudad de destino y el idioma de la app, y luego las coordenadas de ese lugar | El clima del día; el pronóstico diario de un viaje |
| Apple | Tu identidad de Iniciar sesión con Apple y, cuando eliminas tu cuenta, una solicitud para revocar el acceso de la app | El inicio de sesión, y cortar ese vínculo cuando te vas |
| Google | Tu identidad de Iniciar sesión con Google | El inicio de sesión |
| Brevo | Tu correo electrónico y el código de confirmación o para restablecer la contraseña | Enviar los correos de tu cuenta |

Los servicios de IA reciben estas solicitudes desde el servidor de la app, nunca directamente desde
tu teléfono, y el servidor nunca les envía tus fotos salvo para el reconocimiento de prendas y la
revisión de "¿Lo compro?" descritos arriba. Cuando tocas "Buscar en tiendas" en una idea de "Para ti" y eliges una tienda (Falabella, Mercado
Libre, Google Shopping o Google, según tu país), tu navegador abre la búsqueda de esa tienda con
palabras genéricas como "blazer camel mujer"; a esa búsqueda se aplica la política de privacidad de
la tienda.

## Cuánto tiempo se guardan

Tus datos se guardan hasta que los eliminas o eliminas tu cuenta, salvo los planes, que se borran
30 días después de su día. Puedes eliminar cualquier prenda
(sus fotos también se borran), cualquier uso registrado, outfit guardado, plan o viaje guardado cuando quieras,
volver a incluir una prenda en las sugerencias desde su detalle y restaurar todas las combinaciones
ocultas desde Perfil. El dueño de la app guarda
cada noche una copia de seguridad de la base de datos y las fotos en su propia computadora, solo para
recuperación, y conserva las 14 más recientes; los datos que eliminas desaparecen de las copias de
seguridad después de las 14 copias nocturnas siguientes (unas dos semanas cuando se hacen todas las
noches).

Cada proveedor de arriba aplica sus propias reglas de conservación a lo que recibe de la app.

## Tus opciones: exportar y eliminar

- **Exportar.** Perfil → Privacidad → "Exportar mis datos" te da un archivo con tu perfil, tus
  prendas (con los precios que hayas escrito), tus outfits, tus usos, tus outfits planeados, tus viajes guardados y las combinaciones que marcaste con "No es para mí", más enlaces a
  tus fotos que funcionan durante 7 días.
- **Eliminar tu cuenta.** Perfil → Privacidad → "Eliminar cuenta", confirmado dos veces, borra tus
  fotos, revoca Iniciar sesión con Apple si lo usaste, y elimina tu cuenta y cada fila que le
  pertenece. Después la app borra su copia de tus datos en ese teléfono y cierra tu sesión.

También puedes cambiar o borrar cualquier dato de tu perfil cuando quieras en la pestaña Perfil, y
elegir no dar tu ciudad ni tus datos corporales.

## Cambios y contacto

Si esta política cambia, la nueva versión se publicará en esta página con una fecha nueva. Para
cualquier pregunta, o para pedir tus datos o su eliminación, escribe a [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com).
