// ─────────────────────────────────────────────────────────────
// Catàleg d'aliments amb foto (secció Productos de la planificació)
// ─────────────────────────────────────────────────────────────
// Fotos reals de Pixabay (llicència Pixabay: ús lliure, sense atribució),
// totes amb el mateix estil: aliment sol, centrat, sobre blanc i amb una ombra
// suau. Són a public/alimentos/<id>.jpg i les genera
// scripts/food-catalog-photos.py a partir del camp `pixabay`.
//
// Triar-ne una la copia a la biblioteca de productes (planLibrary.productos),
// així el PDF i les còpies de seguretat no depenen del catàleg.

import { dishKey } from './planificacion';

export const FOOD_GROUPS = ['proteinas', 'lacteos', 'cereales', 'verduras', 'frutas', 'frutosSecos'];

/** @type {{ id, nombre, grupo, alias?: string[], pixabay: string }[]} */
export const FOOD_CATALOG = [
  // Proteïnes
  { id: 'salmon',        nombre: 'Salmón',          grupo: 'proteinas',  alias: ['Lomo de salmón', 'Filete de salmón', 'Salmón fresco'], pixabay: '2017/08/11/14/36/fish-2631412.png' },
  { id: 'merluza',       nombre: 'Merluza',         grupo: 'proteinas',  alias: ['Lomo de merluza', 'Filete de merluza', 'Bacalao', 'Bacalao fresco', 'Pescado blanco'], pixabay: '2016/11/09/22/50/cod-1813072.png' },
  { id: 'atun',          nombre: 'Atún fresco',     grupo: 'proteinas',  alias: ['Atún', 'Atún rojo'], pixabay: '2018/02/20/19/57/tuna-3168681.png' },
  { id: 'gambas',        nombre: 'Gambas',          grupo: 'proteinas',  alias: ['Gamba', 'Langostinos', 'Langostino'], pixabay: '2017/06/11/22/55/shrimp-2393818.jpg' },
  { id: 'ternera',       nombre: 'Ternera',         grupo: 'proteinas',  alias: ['Filete de ternera', 'Carne de ternera', 'Solomillo de ternera', 'Ternera magra'], pixabay: '2017/10/18/16/14/beef-2864657.png' },
  { id: 'jamon',         nombre: 'Jamón serrano',   grupo: 'proteinas',  alias: ['Jamón', 'Jamón ibérico'], pixabay: '2013/01/08/01/23/ham-74327.jpg' },
  { id: 'huevos',        nombre: 'Huevos',          grupo: 'proteinas',  alias: ['Huevo', 'Huevos camperos'], pixabay: '2016/07/08/18/18/egg-1504992.png' },
  { id: 'lentejas',      nombre: 'Lentejas',        grupo: 'proteinas',  alias: ['Lenteja', 'Lentejas rojas', 'Lentejas cocidas'], pixabay: '2017/02/25/12/38/lenses-2097626.jpg' },
  { id: 'garbanzos',     nombre: 'Garbanzos',       grupo: 'proteinas',  alias: ['Garbanzo', 'Garbanzos cocidos'], pixabay: '2014/04/05/11/40/chickpea-316594.jpg' },
  // Làctics
  { id: 'leche',         nombre: 'Leche',           grupo: 'lacteos',    alias: ['Leche semidesnatada', 'Leche desnatada', 'Leche entera', 'Vaso de leche'], pixabay: '2014/09/04/05/27/milk-435295.png' },
  { id: 'queso',         nombre: 'Queso',           grupo: 'lacteos',    alias: ['Queso curado', 'Queso semicurado', 'Queso emmental'], pixabay: '2016/03/05/19/24/cheese-1238395.jpg' },
  // Cereals i tubercles
  { id: 'avena',         nombre: 'Copos de avena',  grupo: 'cereales',   alias: ['Avena', 'Copos de avena integral'], pixabay: '2016/02/04/01/23/oat-1178444.jpg' },
  { id: 'pasta',         nombre: 'Pasta',           grupo: 'cereales',   alias: ['Pasta integral', 'Espaguetis', 'Espaguetis integrales'], pixabay: '2017/12/18/22/01/pasta-3026986.jpg' },
  { id: 'pan',           nombre: 'Pan integral',    grupo: 'cereales',   alias: ['Pan', 'Pan de centeno', 'Pan de semillas'], pixabay: '2017/08/23/19/35/rye-bread-2673996.png' },
  { id: 'pan-molde',     nombre: 'Pan de molde',    grupo: 'cereales',   alias: ['Pan de molde integral'], pixabay: '2019/12/14/15/24/bread-4695116.png' },
  { id: 'patata',        nombre: 'Patata',          grupo: 'cereales',   alias: ['Patatas', 'Patata cocida'], pixabay: '2017/10/08/07/54/potatoes-2829118.png' },
  { id: 'boniato',       nombre: 'Boniato',         grupo: 'cereales',   alias: ['Batata'], pixabay: '2018/05/12/00/53/sweet-potato-3392187.png' },
  // Verdures
  { id: 'tomate',        nombre: 'Tomate',          grupo: 'verduras',   alias: ['Tomates'], pixabay: '2016/03/05/19/03/tomatoes-1238255.jpg' },
  { id: 'zanahoria',     nombre: 'Zanahoria',       grupo: 'verduras',   alias: ['Zanahorias'], pixabay: '2016/09/25/16/34/carrots-1694087.jpg' },
  { id: 'brocoli',       nombre: 'Brócoli',         grupo: 'verduras',   pixabay: '2016/12/05/16/52/broccoli-1884353.png' },
  { id: 'calabacin',     nombre: 'Calabacín',       grupo: 'verduras',   pixabay: '2018/06/17/14/45/zucchini-3480653.jpg' },
  { id: 'espinacas',     nombre: 'Espinacas',       grupo: 'verduras',   alias: ['Espinaca', 'Espinacas frescas', 'Espinacas baby'], pixabay: '2016/11/05/00/05/spinach-1799266.jpg' },
  { id: 'pimiento',      nombre: 'Pimiento rojo',   grupo: 'verduras',   alias: ['Pimiento', 'Pimientos'], pixabay: '2019/09/21/18/24/red-pepper-4494487.png' },
  { id: 'cebolla',       nombre: 'Cebolla',         grupo: 'verduras',   pixabay: '2016/03/05/19/15/onion-1238338.jpg' },
  { id: 'cebolla-morada', nombre: 'Cebolla morada', grupo: 'verduras',   alias: ['Cebolla roja'], pixabay: '2020/05/18/15/54/onion-5187140.jpg' },
  { id: 'berenjena',     nombre: 'Berenjena',       grupo: 'verduras',   pixabay: '2017/08/11/09/16/eggplant-2630097.png' },
  { id: 'champinones',   nombre: 'Champiñones',     grupo: 'verduras',   alias: ['Champiñón'], pixabay: '2018/09/03/02/44/mushrooms-3650274.png' },
  { id: 'lechuga',       nombre: 'Lechuga',         grupo: 'verduras',   alias: ['Lechuga romana'], pixabay: '2017/07/03/18/14/lettuce-2468495.png' },
  { id: 'endibias',      nombre: 'Endibias',        grupo: 'verduras',   alias: ['Endibia'], pixabay: '2017/04/04/10/00/a-vegetable-2200858.png' },
  { id: 'pepino',        nombre: 'Pepino',          grupo: 'verduras',   pixabay: '2020/04/07/06/06/cucumber-5012188.png' },
  // Fruites
  { id: 'platano',       nombre: 'Plátano',         grupo: 'frutas',     pixabay: '2016/07/08/18/05/banana-1504956.png' },
  { id: 'manzana',       nombre: 'Manzana',         grupo: 'frutas',     alias: ['Manzana roja'], pixabay: '2020/04/07/06/07/apple-5012196.png' },
  { id: 'manzana-verde', nombre: 'Manzana verde',   grupo: 'frutas',     pixabay: '2016/03/05/22/30/apple-1239300.jpg' },
  { id: 'naranja',       nombre: 'Naranja',         grupo: 'frutas',     pixabay: '2018/02/17/16/25/orange-free-3160293.png' },
  { id: 'kiwi',          nombre: 'Kiwi',            grupo: 'frutas',     pixabay: '2017/04/04/11/14/fruit-2201090.png' },
  { id: 'fresas',        nombre: 'Fresas',          grupo: 'frutas',     alias: ['Fresa', 'Fresones'], pixabay: '2014/11/20/13/55/strawberry-539138.png' },
  { id: 'arandanos',     nombre: 'Arándanos',       grupo: 'frutas',     pixabay: '2014/11/20/13/54/blueberry-539135.png' },
  { id: 'aguacate',      nombre: 'Aguacate',        grupo: 'frutas',     pixabay: '2018/08/25/00/35/avocado-3629229.png' },
  { id: 'mango',         nombre: 'Mango',           grupo: 'frutas',     pixabay: '2016/02/23/17/36/mango-1218147.png' },
  { id: 'pera',          nombre: 'Pera',            grupo: 'frutas',     pixabay: '2017/08/21/23/05/pears-2667255.png' },
  { id: 'uvas',          nombre: 'Uvas',            grupo: 'frutas',     alias: ['Uva'], pixabay: '2017/08/23/14/11/grapes-2673039.png' },
  { id: 'pasas',         nombre: 'Pasas',           grupo: 'frutas',     alias: ['Uvas pasas'], pixabay: '2016/10/14/13/31/raisin-1740212.png' },
  // Fruits secs i altres
  { id: 'nueces',        nombre: 'Nueces',          grupo: 'frutosSecos', alias: ['Nuez'], pixabay: '2015/11/23/20/49/walnut-1058958.png' },
  { id: 'almendras',     nombre: 'Almendras',       grupo: 'frutosSecos', alias: ['Almendra', 'Almendras crudas', 'Almendras tostadas'], pixabay: '2016/10/14/12/56/almond-1740161.png' },
  { id: 'cacahuetes',    nombre: 'Cacahuetes',      grupo: 'frutosSecos', alias: ['Cacahuete', 'Cacahuetes naturales'], pixabay: '2014/04/05/11/39/peanuts-316472.jpg' },
  { id: 'chocolate',     nombre: 'Chocolate negro', grupo: 'frutosSecos', alias: ['Chocolate', 'Chocolate negro 85%', 'Chocolate 85%'], pixabay: '2017/10/13/23/34/chocolate-2849353.png' },
];

/** Ruta de la foto d'un aliment del catàleg (servida des de public/). */
export const foodCatalogImage = (food) => `/alimentos/${food.id}.jpg`;

// Plural simple: "huevos" i "huevo" són el mateix aliment
const singular = (key) => key.replace(/(?<=[aeiou])s$/, '');

const INDEX = new Map();
for (const food of FOOD_CATALOG) {
  for (const name of [food.nombre, ...(food.alias || [])]) {
    const key = dishKey(name);
    if (!INDEX.has(key)) INDEX.set(key, food);
    if (!INDEX.has(singular(key))) INDEX.set(singular(key), food);
  }
}

/**
 * Aliment del catàleg que es diu igual (nom o àlies, sense majúscules,
 * accents ni plural). Només coincidència exacta: "Tomate frito" no és tomate.
 */
export function findCatalogFood(name) {
  const key = dishKey(name);
  if (!key) return null;
  return INDEX.get(key) || INDEX.get(singular(key)) || null;
}

/** Aliments del catàleg que contenen el text (nom o àlies). */
export function filterFoodCatalog(query, items = FOOD_CATALOG) {
  const q = dishKey(query);
  if (!q) return items;
  return items.filter(f => [f.nombre, ...(f.alias || [])].some(n => dishKey(n).includes(q)));
}
