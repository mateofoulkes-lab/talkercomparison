# Talker Comparison

Web benchmark para comparar generadores de **co-speech body gesture** usando el mismo audio, el mismo rig visual y la misma cámara.

## Estado actual

La primera versión ya permite:

- cargar un audio local;
- reproducir / pausar / scrubbear una timeline común;
- ver varios esqueletos 3D sincronizados;
- alternar cámara frontal, lateral y 3/4;
- activar trails de manos;
- ajustar intensidad global;
- cargar movimientos reales convertidos al formato JSON común;
- descargar nuevamente el JSON cargado.

Los movimientos que aparecen por defecto son **previews procedurales de referencia** para comprobar la UI y la sincronización. No son inferencias reales de PantoMatrix, StreamTalk, UNICAMP, DLP3D ni Free-form.

## Colab

### EMAGE — audio largo

`colab/talkercomparison_pantomatrix.ipynb`

Notebook para generar movimiento corporal con EMAGE desde audios largos sin depender de ZeroGPU.

### Sherlock Holmes en Buenos Aires — Reel IA

`colab/sherlock_buenos_aires_reel.ipynb`

Pipeline de producción para Google Colab basado en **Wan 2.1 T2V 1.3B**:

- 10 planos de ~5 s;
- salida vertical nativa 480×832;
- voz en off exacta en español;
- overlays visuales de deducción desde el segundo 10;
- guardado persistente en Google Drive y reanudación por plano;
- montaje automático de un Reel final de 50 s a 1080×1920.

El notebook arranca renderizando sólo el plano 1 para validar la GPU. Después puede configurarse para generar los 10 planos; los ya existentes se saltean automáticamente.

## Modelos previstos

1. PantoMatrix / EMAGE
2. StreamTalk
3. UNICAMP GENEA
4. DLP3D Speech2Motion
5. Free-form Co-Speech
6. Custom / imported

## Formato común

Ver `common-motion.schema.json`.

Cada frame usa nombres de joints normalizados y rotaciones quaternion `[x,y,z,w]`.

Ejemplo mínimo:

```json
{
  "model": "pantomatrix",
  "fps": 30,
  "source": "example",
  "frames": [
    {
      "root": { "position": [0, 0, 0] },
      "joints": {
        "chest": { "rotation": [0, 0, 0, 1] },
        "leftUpperArm": { "rotation": [0, 0, 0, 1] }
      }
    }
  ]
}
```

Joints usados por el viewer:

`hips`, `spine`, `chest`, `neck`, `head`, `leftShoulder`, `leftUpperArm`, `leftForeArm`, `leftHand`, `rightShoulder`, `rightUpperArm`, `rightForeArm`, `rightHand`, `leftUpperLeg`, `leftLowerLeg`, `leftFoot`, `rightUpperLeg`, `rightLowerLeg`, `rightFoot`.

## Cómo conectar un modelo real

La idea es mantener el frontend agnóstico. Cada backend/adaptador debe hacer:

```text
audio.wav
   ↓
modelo original
   ↓
SMPL-X / SMPL-H / BVH / poses / formato propio
   ↓
adapter
   ↓
Talker Common Motion JSON
   ↓
viewer
```

Si el JSON contiene `model: "streamtalk"`, se carga automáticamente en esa tarjeta. Si no, el nombre de archivo puede incluir `pantomatrix`, `streamtalk`, `unicamp`, `dlp3d` o `freeform`. Todo lo demás cae en `custom`.

## Ejecutar

Es una web estática. Necesita servirse por HTTP porque usa módulos ES.

Cualquier servidor estático sirve; también puede publicarse con GitHub Pages sin cambiar el código.

## Próximo paso

Crear adaptadores reales empezando por PantoMatrix/EMAGE y StreamTalk, normalizando sus esqueletos al formato común. Después se puede agregar export a BVH/FBX o un retarget directo hacia Unity Humanoid.
