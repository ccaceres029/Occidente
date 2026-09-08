# Firma de correo MACAO

- `Firma_Arturo_Caceres_MACAO.png`: imagen de 650 x 206 px para insertar en la firma.
- `Firma_Arturo_Caceres_MACAO@2x.png`: imagen de 1300 x 412 px; mostrar a 650 x 206 px para mayor nitidez.
- `Firma_Arturo_Caceres_MACAO.html`: documento independiente con enlaces de telefono, correo y sitio web.

El HTML incluye las imagenes como datos embebidos para su visualizacion local. Algunos clientes de correo eliminan estas imagenes al pegar o enviar; su instalacion requiere comprobarlas en un correo de prueba o adjuntarlas mediante el editor de firmas. No se ha configurado ni validado en Outlook. La version PNG no contiene enlaces individuales.

El logo original se conserva sin modificar. Colores de composicion: rojo #FF0006, carbon #242021 y blanco. Los archivos no requieren un servidor web.

## Regeneracion

Requiere Node.js, `sharp`, `playwright`, `lucide` y Google Chrome instalado. Ejecutar `node generar-firma.cjs`. Opcionalmente definir `MACAO_NODE_MODULES` con la ruta de las dependencias. El generador verifica carga de imagenes, contenido, dimensiones y destinos de enlaces; exporta ambas imagenes con Chrome sin interfaz.
