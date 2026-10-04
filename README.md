# 🌐 Video Merger Web Studio

Aplicación **100% Web (Client-Side)** para unir y comprimir videos directamente en el navegador mediante **WebAssembly (FFmpeg.wasm)** y APIs nativas de HTML5.

---

## 🔒 100% Privado y en tu Navegador
- **Sin subir videos a internet**: El procesamiento se realiza íntegramente en la memoria de tu dispositivo. Tus videos nunca viajan a ningún servidor externo.
- **Sin scripts de escritorio ni instaladores**: Es una web estándar que funciona en Chrome, Edge, Firefox, Safari (PC, Mac, iPhone, Android).
- **Offline / Autónomo**: Incluye los binarios WebAssembly y librerías locales, por lo que no depende de servicios de terceros.

---

## ✨ Características

1. **Reordenación Completa y Visual**:
   - Arrastra y suelta (`Drag & Drop`) las tarjetas de video para ordenarlas como quieras.
   - Botones rápidos: Subir ⬆️, Bajar ⬇️, Invertir orden 🔄 y ordenar alfabéticamente A-Z 🔤.
   - Miniaturas instantáneas de cada video generadas con aceleración gráfica por el navegador.
   - Vista previa con reproductor de video de cada clip individual.

2. **Sin pérdida de calidad (Modo Ultrarrápido)**:
   - Modo de copia directa (`-c copy`) cuando los videos tienen el mismo formato: une los videos en segundos sin re-codificar ningún fotograma.

3. **Compresión Inteligente**:
   - Activa el interruptor **"Comprimir video final"**:
     - 💎 **Máxima Calidad (CRF 18)**: Prácticamente sin pérdida visual.
     - ⚖️ **Equilibrado (CRF 22 - Recomendado)**: Reduce notablemente el peso conservando gran nitidez.
     - 📦 **Alta Compresión (CRF 28)**: Archivos pequeños para compartir por WhatsApp, correo o redes sociales.

4. **Tratamiento inteligente de formatos mixtos**:
   - Adapta automáticamente resoluciones diferentes (por ejemplo, combina videos verticales y horizontales sin deformar).

---

## 🚀 Cómo Abrir y Usar la App

### Opción 1: Abrir directamente en tu navegador (Local)
Simplemente haz doble clic sobre:
```text
index.html
```
(O arrástralo a una pestaña de tu navegador habitual como Google Chrome, Microsoft Edge o Firefox).

> **Nota para Chrome/Edge en modo local (`file:///`)**:
> Si lo abres directamente como archivo local, la aplicación cargará automáticamente el motor WebAssembly a través de la red segura CDN.
> Si deseas ejecutarlo con servidor web local en un segundo:
> ```bash
> python -m http.server 8080
> ```
> Y abrir `http://localhost:8080` en tu navegador.

---

### Opción 2: Publicarlo en Internet Gratis (GitHub Pages, Netlify o Vercel)
Al ser una aplicación web estática pura (HTML, CSS y JavaScript):
1. **En GitHub Pages**: Sube los archivos a un repositorio de GitHub, activa *Settings -> Pages* y tendrás tu app en `https://tu-usuario.github.io/tu-repo`.
2. **En Netlify / Vercel**: Arrastra la carpeta completa del proyecto al panel de control de Netlify y obtendrás una URL pública inmediata para usarla tú y tus amigos desde cualquier dispositivo.
