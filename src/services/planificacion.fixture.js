// Planificació d'exemple per als tests i per revisar el disseny del PDF.
import { createPlanificacion } from './planificacion';

const dish = (titulo, alimentos, receta = '') => ({ titulo, alimentos: alimentos.join('\n'), receta });

export function samplePlanificacion() {
  const p = createPlanificacion({ clienteId: 'c1', plans: [], today: '2026-10-29' });
  p.desayunos.opciones = [
    { id: 'd1', titulo: 'Café con leche + bowl de yogur con cereales', alimentos: 'Café con 150 ml de leche semidesnatada o de avena (sin azúcar)\nYogur griego natural ligero (170 g)\n35 g de cereales*\nCanela\nOpcional: 1 puñado de arándanos', nota: '' },
    { id: 'd2', titulo: 'Café con leche + tostadas con jamón y tomate', alimentos: 'Café con 150 ml de leche semidesnatada o de avena (sin azúcar)\nPan integral (60 g)\nJamón serrano (2 lonchas grandes)\nTomate rallado\nAOVE (5 ml)', nota: '' },
    { id: 'd3', titulo: 'Café con leche + tostadas con aguacate y queso cottage', alimentos: 'Café con 150 ml de leche semidesnatada o de avena (sin azúcar)\nAguacate (1/4)\nQueso cottage (40 g)', nota: '' },
    { id: 'd4', titulo: 'Café con leche + avena trasnochada', alimentos: 'Copos de avena (35 g)\nYogur griego natural ligero (170 g)\nFresas o arándanos (1 puñado)\n1 cucharada de semillas de chía', nota: 'Pon todo en un tarrito en la nevera el día de antes ⟶ listo por la mañana' },
  ];
  p.desayunos.nota = 'Cereales que puedes elegir: avena crunchy, corn flakes 0 %.';
  p.mediaManana.opciones = [
    { id: 'm1', titulo: 'Pieza de fruta', alimentos: 'Ej.: plátano, manzana, naranja… (o táper variado)', nota: '' },
  ];
  p.merienda.opciones = [
    { id: 'n1', titulo: 'Frutos secos naturales + 1 onza de chocolate negro', alimentos: '1 puñado de frutos secos naturales (15 g, ej.: nueces)\n1 onza de chocolate negro (72-85 %)', nota: '' },
    { id: 'n2', titulo: 'Tortitas de arroz con queso cottage y miel', alimentos: '2 tortitas de arroz\nQueso cottage (2 cucharadas)\n1 cucharada pequeña (5 ml) de miel', nota: '' },
    { id: 'n3', titulo: 'Tostada con jamón cocido y tomate', alimentos: '1 rebanada (30 g) de pan integral\n1 loncha grande de jamón cocido (+92 % carne)\nTomate rallado o a rodajas', nota: '' },
  ];
  const week = [
    [dish('Rostidera de sepia + ensalada', ['Sepia', 'Patata', 'Cebolla, tomate', 'Ensalada con las verduras que quieras'], 'https://example.com/receta/sepia'),
     dish('Merluza a la plancha con salteado rústico + ensalada', ['Merluza (plancha)', 'Salteado rústico* (airfryer)', 'Ensalada con las verduras que quieras']),
     dish('Ensalada de jamón', ['¼ aguacate', 'Melocotón o nectarina', 'Tomate', 'Rúcula (opcional)', 'Queso cottage (2 cucharadas grandes)', '1 loncha jamón serrano'], 'example.com/receta/ensalada-jamon'),
     dish('Minipizzas de berenjena en airfryer', ['1 bola mozzarella light*', 'Berenjena a rodajas', 'Tomate triturado', '1 loncha de pavo'])],
    [dish('Tallarines con pollo y verduras', ['Espaguetis integrales', 'Pollo, pechuga (plancha)', 'Verduras que quieras (cebolla, calabacín, pimiento rojo, brócoli…)', '2 cucharadas salsa de soja']),
     dish('Fajitas de pollo y verduras', ['2 fajitas integrales', 'Pollo, pechuga (plancha)', 'Cebolla, puerro, pimiento rojo y verde (plancha)']),
     dish('Merluza a la plancha con tomate + ensalada', ['Merluza (plancha)', 'Tomate triturado, orégano', 'Ensalada con las verduras que quieras']),
     dish('Lubina a la plancha + coliflor crujiente', ['Lubina (plancha)', 'Coliflor', 'Especias (pimentón, etc.)'], 'https://example.com/coliflor')],
    [dish('Lentejas con jamón y verduras', ['Lentejas', 'Verduras que quieras (cebolla, judías verdes, zanahoria, calabacín…)', 'Taquitos de jamón']),
     dish('Ensalada de garbanzos', ['Garbanzos cocidos', 'Cebolla morada, pepino, tomate cherry, maíz', 'Queso fresco de cabra (40 g)']),
     dish('Pollo con pisto + ensalada', ['Pollo, pechuga (plancha)', 'Pisto* (2 cucharadas)', 'Ensalada con las verduras que quieras']),
     dish('Burger de pollo al plato con verduras salteadas', ['Burger de pollo (plancha)', 'Cebolla, champiñones, calabacín (plancha)'])],
    [dish('Pollo asado con patatas + ensalada', ['1 muslo de pollo (sin piel)', 'Limón, ajo', 'Patata', 'Ensalada con las verduras que quieras']),
     dish('Bowl de pollo con boniato', ['Pollo, pechuga (plancha)', 'Boniato (microondas o airfryer)', 'Aguacate (1/4)', 'Mango (1/2)', 'Tomate cherry']),
     dish('Tortilla francesa + salmorejo con taquitos de jamón', ['Salmorejo (200 ml aprox.)', 'Taquitos de jamón (40 g)', '2 huevos']),
     dish('Huevos rotos con calabaza', ['2 huevos (plancha, NO fritos)', '1 loncha jamón serrano', 'Calabaza (airfryer)'], 'https://example.com/huevos')],
    [dish('Ensalada campera con salsa de yogur griego', ['Patata hervida', '1 lata atún al natural', '1 huevo duro', 'Tomate cherry', 'Pepinillo', '2-3 olivas negras partidas', 'Yogur griego ligero, mostaza'], 'https://example.com/campera'),
     dish('Merluza con pisto + patata cocida + ensalada', ['Merluza (plancha)', 'Pisto* (2 cucharadas)', 'Patata cocida* (o al micro)', 'Ensalada con las verduras que quieras']),
     dish('Pizza casera de pollo y verduras', ['1 base de pizza*', 'Mozzarella rallada', 'Tomate triturado', 'Pollo en tiras, pechuga', 'Champiñones, maíz, cebolla…']),
     dish('LIBRE CON MODERACIÓN (elegir 1 comida)', [])],
    [dish('Berenjenas rellenas de carne', ['Berenjena', 'Carne picada de pollo', 'Puerro, zanahoria, pimiento rojo', 'Tomate triturado', 'Opcional: mozzarella rallada'], 'https://example.com/berenjenas'),
     dish('Lasaña de calabaza', ['Calabaza', 'Carne picada de pollo', 'Cebolla, puerro, tomate triturado, mozzarella', 'Nata ligera'], 'https://example.com/lasana'),
     dish('Serranito saludable + ensalada', ['Pan integral (60 g)', 'Lomo fresco (plancha)', 'Pimiento verde (plancha)', '1 loncha jamón serrano', 'Guarnición de ensalada']),
     dish('LIBRE CON MODERACIÓN (elegir 1 comida)', [])],
    [dish('Arroz con pollo y verduras + ensalada', ['Arroz', 'Pollo, contramuslo o pechuga', 'Cebolla, ajo', 'Setas', 'Tomate natural', 'Vino blanco', 'Alcachofas', 'Azafrán'], 'https://example.com/arroz'),
     dish('Fideuá de pollo y verduras', ['Fideo grueso', 'Contramuslo de pollo', 'Judías verdes', 'Ajo, cebolla, pimiento verde, pimiento rojo', 'Caldo de pollo', 'Tomate'], 'https://example.com/fideua'),
     dish('Rollitos de pepino con atún', ['Pepino a láminas', 'Queso crema light* (2 cucharadas) o queso cottage', '1 lata atún al natural'], 'https://example.com/rollitos'),
     dish('Revuelto de gambas con verduras', ['Gambas (plancha)', 'Verdura que quieras (zanahoria, champiñones, calabacín, pimiento rojo)', '2 cucharadas salsa de soja'])],
  ];
  p.menu.dias = p.menu.dias.map((d, i) => ({
    ...d,
    comida: { a: week[i][0], b: week[i][1] },
    cena: { a: week[i][2], b: week[i][3] },
  }));
  return p;
}
