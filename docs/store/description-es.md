# Chrome Web Store description: Spanish

Paste into the dashboard under Store listing → **Add language → Español**. Plain text: the store shows
line breaks but no Markdown. Keep it true to the code and to `PRIVACY.md`.

The extension's interface is in English and Turkish only; the text says so, so that nobody installs it
expecting Spanish menus. Translating into Spanish works (Spanish is one of the target languages).

## Descripción breve (132 caracteres como máximo)

The store takes the short description from the package. There is no `src/_locales/es/` yet, so the
Spanish listing shows the English short description. To show this one, add
`src/_locales/es/messages.json` with `extName`, `extDescription` and the three command descriptions.

Proposed (118):

```
Traduce palabras en páginas web y subtítulos de YouTube, guárdalas en tu colección y apréndelas con breves flashcards.
```

## Descripción detallada

```
¿Te encuentras una palabra que no conoces? Haz doble clic, mira la traducción al instante y sigue leyendo. Wordvault la guarda por ti y te la vuelve a preguntar en pequeños cuestionarios hasta que la recuerdas.

Wordvault es una extensión de traducción pensada para aprender vocabulario: en lugar de buscar palabras en el diccionario y olvidarlas, las vas reuniendo mientras lees y las repasas poco a poco.

Importante: la interfaz de la extensión está en inglés y en turco. Puedes traducir a español y desde muchos otros idiomas.

TRADUCE SIN SALIR DE LA PÁGINA
• Haz doble clic en cualquier palabra y verás su traducción justo al lado; también puedes escuchar su pronunciación.
• Selecciona una frase o un párrafo entero y tradúcelo desde el menú contextual, con el pequeño botón "Translate" junto a la selección o con un atajo de teclado.
• En YouTube, pasa el puntero sobre una palabra de los subtítulos y tradúcela sin detener lo que estás viendo.
• ¿Texto que no se puede seleccionar? Pausa el vídeo o abre la imagen, dibuja un recuadro sobre el texto y las palabras se vuelven clicables. El texto se lee en tu propio dispositivo (reconoce texto en inglés y en turco).
• Las traducciones vienen por defecto de MyMemory, un servicio de traducción gratuito. Si tienes una clave de API de DeepL, puedes usar DeepL en su lugar.

CREA TU PROPIA COLECCIÓN DE VOCABULARIO
• Con un solo clic en "Add to vault" guardas la palabra junto con la frase en la que apareció, además de definiciones y ejemplos de Wiktionary.
• Busca en tu colección, fíltrala por idioma y guarda las expresiones aparte de las palabras sueltas.
• Expórtala a un archivo cuando quieras e impórtala en otro navegador.

REPASA CON FLASHCARDS
• De vez en cuando, Wordvault te pregunta por algunas palabras guardadas: en una pequeña tarjeta sobre la página, en la ventana de la barra de herramientas o en una ventana aparte. Tú decides con qué frecuencia y en qué horas no debe molestarte.
• Cuatro formas de practicar: elegir el significado entre cuatro opciones, escribir la palabra, escuchar y elegir, o escuchar y escribir.
• Repetición espaciada: las palabras que fallas vuelven antes; las que ya dominas, cada vez con menos frecuencia.
• Una palabra solo cuenta como aprendida tras varias respuestas correctas en días distintos, así que tu progreso es real.
• Un objetivo diario, una racha y rangos que van de Rookie a Legend te muestran cuánto has avanzado. Si quieres, un recordatorio por la tarde te avisa una sola vez si aún no has hecho el cuestionario del día.

FUNCIONES DE IA OPCIONALES (desactivadas hasta que conectes un proveedor)
Necesitan tu propio proveedor de IA: una clave de API de Google Gemini, Claude de Anthropic, NVIDIA o cualquier servicio compatible con OpenAI, u Ollama ejecutándose en tu ordenador (sin clave). Wordvault no está vinculado a ninguno de ellos; cualquier coste es entre tú y el proveedor que elijas, y Wordvault no cobra nada por ello.
• "Explain with AI": el significado de una palabra, frase o párrafo en su contexto.
• "Ask about the image": pregunta sobre una zona de la pantalla.
• "Summarise this page" y "Translate this page with AI". Antes de enviar nada, una tarjeta te muestra cuánto texto es y adónde va; una página traducida siempre se puede devolver a su estado original.
• "Create a test with AI": un examen de práctica en A4 para imprimir (rellenar huecos, verdadero o falso) creado con palabras de tu colección, con hoja de respuestas. Corrígelo en pantalla o imprímelo.
Tu clave de API se queda en tu navegador y solo se envía al proveedor al que pertenece. Las funciones de IA se desactivan en sitios que parecen de banca, correo electrónico o salud.

SINCRONIZACIÓN OPCIONAL ENTRE DISPOSITIVOS
Mantén tu colección al día en varios ordenadores con la sincronización de tu navegador, tu propio Google Drive o tu propio servidor WebDAV. Google Drive requiere tu cuenta de Google; el archivo se guarda en una carpeta oculta que solo Wordvault puede ver y puedes protegerlo con una contraseña. La sincronización está desactivada hasta que tú la actives.

PRIVACIDAD
Sin cuenta, sin anuncios, sin analíticas, sin rastreo. Tu colección vive en tu navegador; Wordvault no tiene ningún servidor que reciba tus palabras ni las páginas que visitas. Al servicio de traducción solo llega el texto que pides traducir. Las capturas para leer texto de la pantalla se procesan en tu dispositivo y no se guardan. El formulario de comentarios muestra exactamente lo que enviará y solo lo envía cuando pulsas "Send". Todos los detalles: [PRIVACY_POLICY_URL]

Wordvault es gratuito y no tiene versión de pago. Si te resulta útil, en los ajustes hay un enlace opcional para apoyar el proyecto ("Support the project").
```
