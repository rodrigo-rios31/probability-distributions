# Distribuciones de Probabilidad

Calculadora de distribuciones de probabilidad con gráficas interactivas, fórmulas y tablas.
Junta las funciones de dos apps (una calculadora de probabilidades con fórmulas y una app de gráficas
con marcadores que se arrastran) en una sola aplicación web que se puede instalar en el celular (PWA).

## Funciones

- **22 distribuciones**
  - Continuas: Normal, t de Student, Chi-cuadrado, F de Fisher, Exponencial, Uniforme, Gamma, Beta,
    Lognormal, Weibull, Cauchy, Logística, Laplace, Pareto, Triangular.
  - Discretas: Binomial, Poisson, Geométrica, Binomial negativa, Hipergeométrica, Uniforme discreta, Bernoulli.
- **5 tipos de cálculo**: cola izquierda `P(X ≤ x)`, cola derecha `P(X ≥ x)`, intervalo `P(x₁ ≤ X ≤ x₂)`,
  dos colas y **cálculo inverso** (percentiles, intervalos centrales y valores críticos).
  En las discretas se puede elegir entre `<` y `≤`.
- **Gráfica interactiva**: área sombreada exacta con el **valor de la probabilidad escrito sobre el área**
  (como en Minitab), puntos rojos que se arrastran (ratón o táctil), tooltip con `f(x)` y `F(x)`,
  vista de densidad o acumulada, líneas de `μ` y `±σ`, exportar a PNG.
- **Procedimiento paso a paso** para cada cálculo, como se resuelve a mano:
  datos del problema → planteamiento (integral de la densidad o suma de `P(X = k)` con los valores sustituidos)
  → método (estandarización `z = (x − μ)/σ` y tabla Z, fórmula cerrada de `F(x)`, regla del complemento,
  suma término a término con combinaciones y potencias, despeje de `x` en el inverso…) → resultado resaltado
  con su interpretación. Incluye notas para verificar con calculadora y con la tabla Z impresa.
- **Medidas**: media, varianza, desviación estándar, mediana, moda, asimetría, curtosis y soporte.
- **Fórmulas** de cada distribución (densidad/masa, acumulada, media, varianza, FGM) renderizadas con KaTeX,
  con descripción y usos.
- **Tabla de probabilidades** configurable, copiable a Excel o exportable a CSV.
- Campos que aceptan expresiones (`1/6`, `sqrt(2)`, `5%`, `2.5e-3`) y botón `±`.
- Tema claro/oscuro, diseño adaptable con barra de pestañas inferior en móvil, enlace para compartir
  la configuración y funcionamiento sin conexión.

## Precisión numérica

Todo se calcula con fórmulas matemáticas en doble precisión, sin tablas ni aproximaciones gruesas:

| Función | Algoritmo |
|---|---|
| Normal Φ(x) | W. J. Cody (como R), exacta también en colas extremas |
| Φ⁻¹(p) | Acklam + refinamiento de Halley |
| Gamma incompleta P(a,x), Q(a,x) | Serie / fracción continua de Lentz |
| Beta incompleta Iₓ(a,b) | Fracción continua de Lentz con simetría |
| Densidades binomial y Poisson | Algoritmo de Loader (saddle point, como R) |
| Cuantiles generales | Método de Brent / bisección entera para discretas |

Las colas se calculan directamente (sin restar de 1), así que probabilidades como `10⁻²⁴` son exactas.
Las pruebas comparan contra valores de referencia de 50 dígitos generados con `mpmath`:
**1383 comprobaciones, peor error relativo ≈ 2×10⁻¹²**.

## Cómo usarla

Abre `index.html` directamente en el navegador, o levanta el servidor local incluido (sin dependencias):

```bash
node server.js
```

y entra a <http://localhost:5173>.

### Instalar en el celular

Publica la carpeta en cualquier hosting con HTTPS (por ejemplo GitHub Pages). Al abrirla desde Chrome
en Android aparecerá la opción **Instalar app** / **Agregar a la pantalla principal**; después funciona
sin conexión.

## Pruebas

```bash
node tests/accuracy.test.js
node tests/procedure.test.js
```

`procedure.test.js` genera el procedimiento para las 22 distribuciones con todos los tipos de cálculo y
desigualdades (≈3 600 casos), renderiza cada fórmula con KaTeX y comprueba que el resultado final
coincide con el de la calculadora.

Para regenerar los valores de referencia: `pip install mpmath` y luego
`python tests/gen_reference.py > tests/reference.json`.

## Estructura

```
index.html              Interfaz
css/styles.css          Estilos (tema claro/oscuro, responsive)
js/special.js           Funciones especiales (gamma, beta, normal, Brent…)
js/distributions.js     Catálogo de distribuciones y utilidades (probabilidades, cuantiles, momentos)
js/format.js            Formato de números
js/chart.js             Gráfica interactiva en canvas
js/procedure.js         Procedimiento paso a paso (fórmulas y sustituciones)
js/app.js               Lógica de la interfaz
vendor/katex/           KaTeX 0.16.11 (fórmulas) incluido localmente
sw.js, manifest.webmanifest   PWA / modo sin conexión
tests/                  Pruebas de precisión
```
