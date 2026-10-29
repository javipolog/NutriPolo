// ─────────────────────────────────────────────────────────────
// Aliments genèrics amb foto (part de la biblioteca d'aliments)
// ─────────────────────────────────────────────────────────────
// Fotos reals de Pixabay (llicència Pixabay: ús lliure, sense atribució),
// totes amb el mateix estil: aliment sol, centrat, sobre blanc i amb una ombra
// suau. Són a public/alimentos/<id>.jpg i les genera
// scripts/food-catalog-photos.py a partir del camp `pixabay`.
//
// Cada un fa servir la categoria del catàleg de Mercadona i, amb `mercadona`,
// el producte equivalent (sourceId) del qual pren els valors nutricionals.
// La unió de tots dos és a foodCatalog.js (`buildFoodLibrary`).

/** @type {{ id, nombre, categoria, alias?: string[], mercadona?: string, pixabay: string }[]} */
export const GENERIC_FOODS = [
  { id: 'avena',          nombre: 'Copos de avena',  categoria: 'Cereales, pan y tubérculos', alias: ['Avena', 'Copos de avena integral'], mercadona: '86368', pixabay: '2016/02/04/01/23/oat-1178444.jpg' },
  { id: 'pasta',          nombre: 'Pasta',           categoria: 'Cereales, pan y tubérculos', alias: ['Pasta integral', 'Espaguetis', 'Espaguetis integrales'], mercadona: '6245', pixabay: '2017/12/18/22/01/pasta-3026986.jpg' },
  { id: 'pan',            nombre: 'Pan integral',    categoria: 'Cereales, pan y tubérculos', alias: ['Pan', 'Pan de centeno', 'Pan de semillas'], mercadona: '12049.1', pixabay: '2017/08/23/19/35/rye-bread-2673996.png' },
  { id: 'pan-molde',      nombre: 'Pan de molde',    categoria: 'Cereales, pan y tubérculos', alias: ['Pan de molde integral'], mercadona: '13810', pixabay: '2019/12/14/15/24/bread-4695116.png' },
  { id: 'patata',         nombre: 'Patata',          categoria: 'Cereales, pan y tubérculos', alias: ['Patatas', 'Patata cocida'], mercadona: '69066', pixabay: '2017/10/08/07/54/potatoes-2829118.png' },
  { id: 'boniato',        nombre: 'Boniato',         categoria: 'Cereales, pan y tubérculos', alias: ['Batata'], mercadona: '69239', pixabay: '2018/05/12/00/53/sweet-potato-3392187.png' },
  { id: 'lentejas',       nombre: 'Lentejas',        categoria: 'Legumbres y derivados', alias: ['Lenteja', 'Lentejas rojas', 'Lentejas cocidas'], mercadona: '5330', pixabay: '2017/02/25/12/38/lenses-2097626.jpg' },
  { id: 'garbanzos',      nombre: 'Garbanzos',       categoria: 'Legumbres y derivados', alias: ['Garbanzo', 'Garbanzos cocidos'], mercadona: '5214', pixabay: '2014/04/05/11/40/chickpea-316594.jpg' },
  { id: 'tomate',         nombre: 'Tomate',          categoria: 'Verduras y hortalizas', alias: ['Tomates'], mercadona: '69937', pixabay: '2016/03/05/19/03/tomatoes-1238255.jpg' },
  { id: 'zanahoria',      nombre: 'Zanahoria',       categoria: 'Verduras y hortalizas', alias: ['Zanahorias'], mercadona: '69586', pixabay: '2016/09/25/16/34/carrots-1694087.jpg' },
  { id: 'brocoli',        nombre: 'Brócoli',         categoria: 'Verduras y hortalizas', mercadona: '69580', pixabay: '2016/12/05/16/52/broccoli-1884353.png' },
  { id: 'calabacin',      nombre: 'Calabacín',       categoria: 'Verduras y hortalizas', mercadona: '69338', pixabay: '2018/06/17/14/45/zucchini-3480653.jpg' },
  { id: 'espinacas',      nombre: 'Espinacas',       categoria: 'Verduras y hortalizas', alias: ['Espinaca', 'Espinacas frescas', 'Espinacas baby'], mercadona: '69730', pixabay: '2016/11/05/00/05/spinach-1799266.jpg' },
  { id: 'pimiento',       nombre: 'Pimiento rojo',   categoria: 'Verduras y hortalizas', alias: ['Pimiento', 'Pimientos'], mercadona: '69310', pixabay: '2019/09/21/18/24/red-pepper-4494487.png' },
  { id: 'cebolla',        nombre: 'Cebolla',         categoria: 'Verduras y hortalizas', mercadona: '69079', pixabay: '2016/03/05/19/15/onion-1238338.jpg' },
  { id: 'cebolla-morada', nombre: 'Cebolla morada',  categoria: 'Verduras y hortalizas', alias: ['Cebolla roja'], mercadona: '69162', pixabay: '2020/05/18/15/54/onion-5187140.jpg' },
  { id: 'berenjena',      nombre: 'Berenjena',       categoria: 'Verduras y hortalizas', mercadona: '69326', pixabay: '2017/08/11/09/16/eggplant-2630097.png' },
  { id: 'champinones',    nombre: 'Champiñones',     categoria: 'Verduras y hortalizas', alias: ['Champiñón'], mercadona: '26951', pixabay: '2018/09/03/02/44/mushrooms-3650274.png' },
  { id: 'lechuga',        nombre: 'Lechuga',         categoria: 'Verduras y hortalizas', alias: ['Lechuga romana'], mercadona: '69122', pixabay: '2017/07/03/18/14/lettuce-2468495.png' },
  { id: 'endibias',       nombre: 'Endibias',        categoria: 'Verduras y hortalizas', alias: ['Endibia'], mercadona: '69591', pixabay: '2017/04/04/10/00/a-vegetable-2200858.png' },
  { id: 'pepino',         nombre: 'Pepino',          categoria: 'Verduras y hortalizas', mercadona: '69584', pixabay: '2020/04/07/06/06/cucumber-5012188.png' },
  { id: 'platano',        nombre: 'Plátano',         categoria: 'Frutas', mercadona: '3819', pixabay: '2016/07/08/18/05/banana-1504956.png' },
  { id: 'manzana',        nombre: 'Manzana',         categoria: 'Frutas', alias: ['Manzana roja'], mercadona: '8177', pixabay: '2020/04/07/06/07/apple-5012196.png' },
  { id: 'manzana-verde',  nombre: 'Manzana verde',   categoria: 'Frutas', mercadona: '3021', pixabay: '2016/03/05/22/30/apple-1239300.jpg' },
  { id: 'naranja',        nombre: 'Naranja',         categoria: 'Frutas', mercadona: '3235', pixabay: '2018/02/17/16/25/orange-free-3160293.png' },
  { id: 'kiwi',           nombre: 'Kiwi',            categoria: 'Frutas', mercadona: '3820', pixabay: '2017/04/04/11/14/fruit-2201090.png' },
  { id: 'fresas',         nombre: 'Fresas',          categoria: 'Frutas', alias: ['Fresa', 'Fresones'], mercadona: '61092', pixabay: '2014/11/20/13/55/strawberry-539138.png' },
  { id: 'arandanos',      nombre: 'Arándanos',       categoria: 'Frutas', mercadona: '5501', pixabay: '2014/11/20/13/54/blueberry-539135.png' },
  { id: 'aguacate',       nombre: 'Aguacate',        categoria: 'Frutas', mercadona: '3830', pixabay: '2018/08/25/00/35/avocado-3629229.png' },
  { id: 'mango',          nombre: 'Mango',           categoria: 'Frutas', mercadona: '3050', pixabay: '2016/02/23/17/36/mango-1218147.png' },
  { id: 'pera',           nombre: 'Pera',            categoria: 'Frutas', mercadona: '3119', pixabay: '2017/08/21/23/05/pears-2667255.png' },
  { id: 'uvas',           nombre: 'Uvas',            categoria: 'Frutas', alias: ['Uva'], mercadona: '3313', pixabay: '2017/08/23/14/11/grapes-2673039.png' },
  { id: 'pasas',          nombre: 'Pasas',           categoria: 'Frutas', alias: ['Uvas pasas'], mercadona: '23010', pixabay: '2016/10/14/13/31/raisin-1740212.png' },
  { id: 'nueces',         nombre: 'Nueces',          categoria: 'Frutos secos y semillas', alias: ['Nuez'], mercadona: '34024', pixabay: '2015/11/23/20/49/walnut-1058958.png' },
  { id: 'almendras',      nombre: 'Almendras',       categoria: 'Frutos secos y semillas', alias: ['Almendra', 'Almendras crudas', 'Almendras tostadas'], mercadona: '34865', pixabay: '2016/10/14/12/56/almond-1740161.png' },
  { id: 'cacahuetes',     nombre: 'Cacahuetes',      categoria: 'Frutos secos y semillas', alias: ['Cacahuete', 'Cacahuetes naturales'], mercadona: '34031', pixabay: '2014/04/05/11/39/peanuts-316472.jpg' },
  { id: 'ternera',        nombre: 'Ternera',         categoria: 'Carne', alias: ['Filete de ternera', 'Carne de ternera', 'Solomillo de ternera', 'Ternera magra'], mercadona: '8936', pixabay: '2017/10/18/16/14/beef-2864657.png' },
  { id: 'jamon',          nombre: 'Jamón serrano',   categoria: 'Carne', alias: ['Jamón', 'Jamón ibérico'], mercadona: '15628', pixabay: '2013/01/08/01/23/ham-74327.jpg' },
  { id: 'salmon',         nombre: 'Salmón',          categoria: 'Pescado y marisco', alias: ['Lomo de salmón', 'Filete de salmón', 'Salmón fresco'], mercadona: '87204', pixabay: '2017/08/11/14/36/fish-2631412.png' },
  { id: 'merluza',        nombre: 'Merluza',         categoria: 'Pescado y marisco', alias: ['Lomo de merluza', 'Filete de merluza', 'Bacalao', 'Bacalao fresco', 'Pescado blanco'], mercadona: '87200', pixabay: '2016/11/09/22/50/cod-1813072.png' },
  { id: 'atun',           nombre: 'Atún fresco',     categoria: 'Pescado y marisco', alias: ['Atún', 'Atún rojo'], mercadona: '87197', pixabay: '2018/02/20/19/57/tuna-3168681.png' },
  { id: 'gambas',         nombre: 'Gambas',          categoria: 'Pescado y marisco', alias: ['Gamba', 'Langostinos', 'Langostino'], mercadona: '24486', pixabay: '2017/06/11/22/55/shrimp-2393818.jpg' },
  { id: 'huevos',         nombre: 'Huevos',          categoria: 'Huevos', alias: ['Huevo', 'Huevos camperos'], mercadona: '31504', pixabay: '2016/07/08/18/18/egg-1504992.png' },
  { id: 'leche',          nombre: 'Leche',           categoria: 'Leche y bebidas vegetales', alias: ['Leche semidesnatada', 'Leche desnatada', 'Leche entera', 'Vaso de leche'], mercadona: '10382', pixabay: '2014/09/04/05/27/milk-435295.png' },
  { id: 'queso',          nombre: 'Queso',           categoria: 'Yogures y quesos', alias: ['Queso curado', 'Queso semicurado', 'Queso emmental'], mercadona: '50944', pixabay: '2016/03/05/19/24/cheese-1238395.jpg' },
  { id: 'chocolate',      nombre: 'Chocolate negro', categoria: 'Otros', alias: ['Chocolate', 'Chocolate negro 85%', 'Chocolate 85%'], pixabay: '2017/10/13/23/34/chocolate-2849353.png' },
];

/** Ruta de la foto d'un aliment genèric (servida des de public/). */
export const genericFoodImage = (food) => `/alimentos/${food.id}.jpg`;
