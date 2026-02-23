
import { readDir, readBinaryFile } from '@tauri-apps/api/fs';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { useProviderMemory } from './providerMemory';

console.log("PDF Scanner Service Loaded (v2 — amb memòria)");
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const monthsEs = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthsShortEs = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthsEn = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthsShortEn = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const getMonthNumber = (str, lang = 'es') => {
    const s = str.toLowerCase().replace('.', '');
    const months = lang === 'es' ? monthsEs : monthsEn;
    const monthsShort = lang === 'es' ? monthsShortEs : monthsShortEn;
    let idx = months.indexOf(s);
    if (idx !== -1) return idx + 1;
    idx = monthsShort.indexOf(s);
    if (idx !== -1) return idx + 1;
    return null;
};

// ============================================
// AUTO-DETECCIÓ DE PROVEÏDORS RECURRENTS
// ============================================

const normalizeProviderName = (name) => {
    if (!name) return '';
    return name.toLowerCase()
        .replace(/[^\w\sàáèéìíòóùúüñç]/g, '')
        .replace(/\s+(s\.?l\.?u?\.?|s\.?a\.?)$/i, '')
        .replace(/\s+/g, ' ').trim();
};

export const matchKnownProvider = (detectedName, existingExpenses = []) => {
    if (!detectedName || !existingExpenses.length) return null;
    const normalizedDetected = normalizeProviderName(detectedName);
    if (normalizedDetected.length < 3) return null;

    const providerMap = new Map();
    existingExpenses.forEach(exp => {
        if (exp.proveedor) {
            const normalized = normalizeProviderName(exp.proveedor);
            if (!providerMap.has(normalized)) {
                providerMap.set(normalized, {
                    proveedor: exp.proveedor, cifProveedor: exp.cifProveedor || '',
                    categoria: exp.categoria, ivaPorcentaje: exp.ivaPorcentaje, count: 1
                });
            } else {
                const existing = providerMap.get(normalized);
                existing.count++;
                if (exp.categoria) existing.categoria = exp.categoria;
                if (exp.cifProveedor && !existing.cifProveedor) existing.cifProveedor = exp.cifProveedor;
            }
        }
    });

    let bestMatch = null, bestScore = 0;
    for (const [normalizedExisting, data] of providerMap) {
        let score = 0;
        if (normalizedExisting === normalizedDetected) score = 100;
        else if (normalizedExisting.includes(normalizedDetected) || normalizedDetected.includes(normalizedExisting)) score = 70;
        else {
            const dw = normalizedDetected.split(' ').filter(w => w.length > 2);
            const ew = normalizedExisting.split(' ').filter(w => w.length > 2);
            const mw = dw.filter(w => ew.some(e => e.includes(w) || w.includes(e)));
            if (mw.length > 0) score = (mw.length / Math.max(dw.length, ew.length)) * 50;
        }
        score += Math.min(data.count * 2, 20);
        if (score > bestScore && score >= 40) { bestScore = score; bestMatch = data; }
    }
    return bestMatch;
};

// ============================================
// CATEGORIES MILLORADES (CGI / FREELANCE / GENERAL)
// ============================================

const categoryKeywords = {
    'Material de oficina': {
        keywords: ['papel', 'boli', 'libreta', 'grapas', 'toner', 'cartucho', 'tinta',
            'papelería', 'material de oficina', 'oficina', 'copistería', 'impresión',
            'fotocopias', 'encuadernación', 'archivador', 'sobres', 'carpeta',
            'etiquetas', 'post-it', 'rotulador', 'clip'],
        weight: 1.0
    },
    'Software y suscripciones': {
        keywords: ['adobe', 'creative cloud', 'figma', 'slack', 'spotify', 'netflix',
            'subscription', 'suscripcion', 'suscripción', 'software', 'saas',
            'license', 'licencia', 'hosting', 'domain', 'dominio', 'cloud', 'aws',
            'google cloud', 'microsoft 365', 'github', 'notion', 'dropbox',
            'google workspace', 'icloud', 'app store', 'play store',
            // CGI / Disseny
            'cinema 4d', 'c4d', 'maxon', 'redshift', 'octane', 'arnold', 'vray',
            'v-ray', 'houdini', 'sidefx', 'substance', 'marvelous designer',
            'zbrush', 'pixologic', 'unreal engine', 'unity', 'blender market',
            'turbosquid', 'cgtrader', 'after effects', 'premiere', 'davinci',
            'davinci resolve', 'blackmagic', 'nuke', 'foundry', 'autodesk',
            'maya', '3ds max', 'sketchup', 'rhino', 'keyshot', 'corona',
            'chaos group', 'itoo forest', 'quixel', 'megascans', 'poliigon',
            'greyscalegorilla', 'kitbash3d', 'wpengine', 'siteground',
            'wordpress', 'elementor', 'envato', 'shutterstock', 'getty',
            'stock', 'midjourney', 'openai', 'chatgpt', 'anthropic', 'claude',
            'copilot', 'vercel', 'netlify', 'heroku', 'digitalocean', 'linode',
            'cloudflare', 'zoom', 'teams', 'meet', 'loom', 'calendly',
            'mailchimp', 'canva', 'miro', 'trello', 'asana', 'monday', 'jira',
            'chatgpt plus', 'copilot pro', 'github copilot'],
        weight: 1.2
    },
    'Equipos informáticos': {
        keywords: ['ordenador', 'portatil', 'portàtil', 'laptop', 'computadora',
            'monitor', 'teclado', 'raton', 'ratón', 'mouse', 'tecnologia',
            'informatica', 'informàtica', 'apple', 'macbook', 'imac',
            'mac mini', 'mac studio', 'mac pro', 'mediamarkt', 'media markt',
            'pccomponentes', 'pc componentes', 'coolmod', 'ram', 'ssd', 'nvme',
            'disco duro', 'grafica', 'gráfica', 'gpu', 'nvidia', 'amd',
            'procesador', 'cpu', 'intel', 'ryzen', 'tablet', 'ipad', 'wacom',
            'cintiq', 'intuos', 'xp-pen', 'huion', 'webcam', 'logitech',
            'auriculares', 'headset', 'altavoces', 'hub usb', 'dock',
            'thunderbolt', 'usb-c', 'nas', 'synology', 'qnap', 'disco externo',
            'wd', 'seagate', 'samsung', 'ups', 'sai', 'impresora', 'escaner',
            'scanner', 'streamdeck', 'elgato', 'rode', 'microfono', 'micrófono',
            'iluminación', 'led panel', 'ring light', 'softbox', 'amazon',
            'amazon.es', 'aliexpress', 'el corte ingles'],
        weight: 1.0
    },
    'Telecomunicaciones': {
        keywords: ['movistar', 'vodafone', 'orange', 'yoigo', 'digi', 'pepephone',
            'o2', 'fibra', 'internet', 'telefono', 'teléfono', 'telefonia',
            'telefonía', 'comunicacion', 'comunicación', 'movil', 'móvil',
            'linea movil', 'línea móvil', 'masmovil', 'más móvil', 'lowi',
            'simyo', 'hits mobile', 'finetwork', 'jazztel', 'ono'],
        weight: 1.0
    },
    'Transporte': {
        keywords: ['gasolina', 'combustible', 'diesel', 'gasoleo', 'gasóleo',
            'repsol', 'cepsa', 'bp', 'glp', 'shell', 'galp', 'bonarea',
            'peaje', 'autopista', 'ap-7', 'ap7', 'via-t', 'transporte',
            'taxi', 'uber', 'cabify', 'freenow', 'bolt', 'bus', 'autobus',
            'autobús', 'tren', 'renfe', 'ave', 'metro', 'tranvía', 'parking',
            'aparcamiento', 'estacionamiento', 'zona azul', 'billete',
            'blablacar', 'flixbus', 'alsa', 'vueling', 'ryanair', 'iberia',
            'easyjet', 'air europa', 'booking', 'airbnb', 'hotel',
            'alojamiento', 'itv', 'revision', 'revisión', 'taller mecanico',
            'neumáticos', 'aceite motor', 'seguro coche', 'kilometraje',
            'dietas', 'desplazamiento'],
        weight: 1.0
    },
    'Formación': {
        keywords: ['curso', 'master', 'máster', 'taller', 'workshop', 'educacion',
            'educación', 'universidad', 'academia', 'udemy', 'coursera',
            'domestika', 'formacion', 'formación', 'clase', 'seminario',
            'conferencia', 'congreso', 'webinar', 'masterclass', 'bootcamp',
            'mentoring', 'mentoría', 'libro', 'ebook', 'manual', 'guía',
            'tutorial', 'pluralsight', 'skillshare', 'linkedin learning',
            'edx', 'platzi', 'crehana', 'gnomon', 'cgma', 'schoolism',
            'learnsquared', 'artstation learning', 'gumroad', 'patreon',
            'certificacion', 'certificación', 'examen', 'acreditación'],
        weight: 1.0
    },
    'Seguros': {
        keywords: ['seguro', 'póliza', 'poliza', 'mapfre', 'axa', 'allianz', 'mutua',
            'sanitas', 'dkv', 'adeslas', 'cobertura', 'prima de seguro',
            'zurich', 'generali', 'liberty', 'pelayo', 'asisa', 'caser',
            'seguro autonomo', 'seguro autónomo', 'responsabilidad civil',
            'rc profesional', 'seguro hogar', 'seguro vida', 'seguro salud',
            'mutualidad', 'reta', 'seguridad social', 'cotización'],
        weight: 1.0
    },
    'Gestoría y asesoría': {
        keywords: ['gestoria', 'gestoría', 'asesoria', 'asesoría', 'asesor fiscal',
            'contable', 'contabilidad', 'declaracion', 'declaración',
            'impuestos', 'modelo 303', 'modelo 130', 'modelo 100',
            'modelo 390', 'modelo 347', 'hacienda', 'agencia tributaria',
            'aeat', 'irpf', 'renta', 'notario', 'notaría', 'registro',
            'certificado digital', 'firma digital', 'abogado', 'procurador',
            'legal', 'jurídico'],
        weight: 1.1
    },
    'Marketing y publicidad': {
        keywords: ['publicidad', 'marketing', 'google ads', 'facebook ads',
            'instagram ads', 'meta business', 'tiktok ads', 'linkedin ads',
            'seo', 'sem', 'posicionamiento', 'campaña', 'anuncio', 'banner',
            'branding', 'logotipo', 'tarjetas visita', 'flyer', 'cartel',
            'vinilo', 'rotulación', 'merchandising', 'redes sociales',
            'community manager', 'influencer', 'patrocinio', 'feria',
            'stand', 'exposición', 'evento profesional'],
        weight: 1.0
    },
    'Suministros': {
        keywords: ['electricidad', 'luz', 'gas', 'agua', 'suministro', 'suministros',
            'iberdrola', 'endesa', 'naturgy', 'repsol luz', 'repsol gas',
            'eléctrica', 'electrica', 'energía', 'energia',
            'potencia contratada', 'factura luz', 'factura gas', 'factura agua',
            'holaluz', 'lucera', 'octopus energy', 'totalenergies',
            'som energia', 'comunidad de propietarios', 'alquiler oficina',
            'coworking', 'alquiler local', 'limpieza oficina'],
        weight: 1.0
    },
    'Servicios profesionales': {
        keywords: ['freelance', 'freelancer', 'consultoría', 'consultoria',
            'subcontratación', 'colaborador', 'externo',
            'proveedor servicios', 'outsourcing', 'render farm',
            'granja de render', 'ranch computing', 'rebus farm',
            'traducción', 'traduccion', 'corrección', 'diseño gráfico',
            'fotografo', 'fotógrafo', 'fotografia', 'fotografía',
            'video', 'vídeo', 'producción', 'postproducción', 'edición',
            'locutor', 'voz en off', 'sonido', 'música', 'audio',
            'modelado 3d', 'animación', 'motion graphics', 'composición',
            'retoque', 'maquetación'],
        weight: 1.0
    },
};

const detectCategoryByKeywords = (text) => {
    const lowerText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let bestCategory = 'Otros';
    let maxScore = 0;

    for (const [category, config] of Object.entries(categoryKeywords)) {
        let score = 0, matchCount = 0;
        for (const kw of config.keywords) {
            const nkw = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (lowerText.includes(nkw)) {
                matchCount++;
                if (kw.length > 12) score += 3.0;
                else if (kw.length > 8) score += 2.0;
                else if (kw.length > 5) score += 1.5;
                else score += 1.0;
            }
        }
        score *= (config.weight || 1.0);
        if (matchCount >= 3) score *= 1.3;
        if (matchCount >= 5) score *= 1.2;
        if (score > maxScore) { maxScore = score; bestCategory = category; }
    }
    return maxScore > 0 ? bestCategory : 'Otros';
};

// ============================================
// DETECCIÓ CIF/NIF PROVEÏDOR
// ============================================

const detectProviderCifNif = (text, userNif) => {
    const cleanUserNif = (userNif || '').replace(/[\s-]/g, '').toUpperCase();
    const cifRegex = /\b([ABCDEFGHJNPQRSUVW]\d{7}[A-Z0-9])\b/gi;
    const nifRegex = /\b(\d{8}[A-Z])\b/gi;
    const candidates = [];
    let match;

    while ((match = cifRegex.exec(text)) !== null) {
        const val = match[1].toUpperCase();
        if (val !== cleanUserNif) {
            const surr = text.substring(Math.max(0, match.index - 30), match.index).toLowerCase();
            const score = (surr.includes('cif') || surr.includes('nif') || surr.includes('n.i.f') || surr.includes('c.i.f')) ? 100 : 50;
            candidates.push({ value: val, score });
        }
    }
    while ((match = nifRegex.exec(text)) !== null) {
        const val = match[1].toUpperCase();
        if (val !== cleanUserNif) {
            const surr = text.substring(Math.max(0, match.index - 30), match.index).toLowerCase();
            const score = (surr.includes('cif') || surr.includes('nif')) ? 90 : 40;
            candidates.push({ value: val, score });
        }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.length > 0 ? candidates[0].value : '';
};

// ============================================
// SCANNER PRINCIPAL
// ============================================

export const scanFolderForReceipts = async (folderPath, config = {}) => {
    console.log(`Scanning roots: ${folderPath}`);
    const results = [];

    const processDirectory = async (currentPath) => {
        try {
            const entries = await readDir(currentPath, { recursive: false });
            const pdfs = entries.filter(e => e.name?.toLowerCase().endsWith('.pdf'));
            const pathParts = currentPath.split(/[\\/]/);

            const yearMatch = pathParts.find(p => /^(20)\d{2}$/.test(p));
            const inferredYear = yearMatch ? parseInt(yearMatch) : new Date().getFullYear();

            let inferredMonth = null;
            for (let i = pathParts.length - 1; i >= 0; i--) {
                const part = pathParts[i].toLowerCase();
                for (let m = 1; m <= 12; m++) {
                    if (part.includes(monthsEs[m - 1]) || part.includes(monthsShortEs[m - 1]) ||
                        part.includes(monthsEn[m - 1]) || part.includes(monthsShortEn[m - 1])) {
                        inferredMonth = m; break;
                    }
                }
                if (inferredMonth) break;
                const numericMatch = part.match(/\b(0[1-9]|1[0-2])\b/);
                if (numericMatch) { inferredMonth = parseInt(numericMatch[1]); break; }
            }

            const quarterMatch = pathParts.find(p => /^T[1-4]$/i.test(p));
            const inferredQuarter = quarterMatch ? parseInt(quarterMatch.toUpperCase().replace('T', '')) : null;

            if (pdfs.length > 0) {
                for (const pdf of pdfs) {
                    try {
                        const data = await processPdf(pdf.path, {
                            inferredYear, inferredMonth, inferredQuarter, config,
                            existingExpenses: config.existingExpenses || [],
                            filename: pdf.name,
                        });
                        if (data) results.push({ file: pdf.path, filename: pdf.name, ...data, inferredQuarter });
                    } catch (err) { console.error(`Error processing ${pdf.name}:`, err); }
                }
            }

            const subdirs = entries.filter(e => {
                const isDir = e.children || (!e.name?.includes('.') && !e.name?.endsWith('.pdf'));
                return isDir && e.name?.toUpperCase() !== 'INGRESOS';
            });
            for (const dir of subdirs) await processDirectory(dir.path);
        } catch (err) { console.error(`Error reading directory ${currentPath}:`, err); }
    };

    await processDirectory(folderPath);
    return results;
};

export const processSinglePdf = async (filePath, context = {}) => {
    return processPdf(filePath, context);
};

const processPdf = async (filePath, context = {}) => {
    const { config } = context;
    console.log("Reading file:", filePath);
    const bytes = await readBinaryFile(filePath);

    const loadingTask = pdfjsLib.getDocument({
        data: bytes,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/cmaps/',
        cMapPacked: true,
    });

    const doc = await loadingTask.promise;
    let metadataItems = [];
    const maxPages = Math.min(doc.numPages, 2);

    for (let i = 1; i <= maxPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageItems = content.items.map(item => {
            const font = content.styles[item.fontName] || {};
            const height = Math.abs(item.transform[3]);
            return {
                str: item.str, height, fontName: item.fontName,
                isBold: /bold|negrita|heavy/i.test(item.fontName) || (font.family && /bold/i.test(font.family)),
                x: item.transform[4], y: item.transform[5]
            };
        });
        metadataItems.push(...pageItems);
    }

    return parseInvoiceText(metadataItems, context);
};

const parseInvoiceText = (metadataItems, context = {}) => {
    const { inferredYear, inferredMonth, config = {}, existingExpenses = [] } = context;
    const userNif = config.nif || '46088365E';
    const userNameParts = (config.nombre || 'Javier Polo García').toLowerCase().split(/\s+/).filter(p => p.length > 2);

    // Accedir a memòria de proveïdors (fora de React)
    let providerMemory = null;
    try {
        providerMemory = useProviderMemory.getState();
    } catch (e) {
        console.log('[pdfScanner] Provider memory not available');
    }

    // Reconstruir text
    const fullText = metadataItems.map(i => i.str).join(' ');
    const sortedItems = [...metadataItems].sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    let currentY = -1, currentLine = '';
    sortedItems.forEach(item => {
        if (Math.abs(item.y - currentY) > 5) {
            if (currentLine) lines.push(currentLine.trim());
            currentLine = item.str; currentY = item.y;
        } else { currentLine += ' ' + item.str; }
    });
    if (currentLine) lines.push(currentLine.trim());

    const cleanText = fullText.replace(/\s+/g, ' ');

    // --- 0. DOMINI ---
    const domainRegex = /\b(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]{3,})\.(?:com|es|ai|net|org|io|eu|it|fr|de|at|info|biz|shop|agency|cloud|app|dev|co|cat)\b/gi;
    let foundDomains = [], dm;
    while ((dm = domainRegex.exec(cleanText)) !== null) {
        const dName = dm[1].charAt(0).toUpperCase() + dm[1].slice(1).toLowerCase();
        if (!foundDomains.includes(dName)) foundDomains.push(dName);
    }

    // --- 1. DATA ---
    const dateKeywords = ['fecha', 'emisión', 'expedición', 'f. factura', 'data', 'factura del día', 'date', 'issued', 'billed', 'fecha factura', 'fecha emisión'];
    const skipKeywords = ['vencimiento', 'due date', 'valid until', 'expiry', 'pagar antes', 'hasta el', 'vence', 'entrega', 'delivery', 'caducidad'];
    const allMonthsEs = [...monthsEs, ...monthsShortEs];
    const allMonthsEn = [...monthsEn, ...monthsShortEn];
    const stdRegex = /(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})|(\d{4})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})/g;
    const longEsRegex = new RegExp(`(\\d{1,2})\\s+(?:de\\s+)?(${allMonthsEs.join('|')})\\.?\\s+(?:de\\s+)?(\\d{4})`, 'gi');
    const longEnRegex = new RegExp(`(${allMonthsEn.join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, 'gi');

    let dateCandidates = [];
    // Keywords que indiquen taules de línies de detall (penalitzar dates dins d'estes)
    const detailTableKeywords = ['cantidad', 'descripción', 'descripcion', 'unidades', 'uds', 'precio', 'importe', 'concepto', 'detalle', 'línea', 'linea', 'artículo', 'articulo', 'referencia', 'ref.'];

    const processDateMatch = (match, type, d, m, y, fullMatch) => {
        if (!m || d < 1 || d > 31 || m < 1 || m > 12 || y < 2010 || y > 2100) return;
        const fechaStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const offset = fullText.indexOf(fullMatch);
        const surrounding = fullText.substring(Math.max(0, offset - 80), Math.min(fullText.length, offset + 80)).toLowerCase();
        let score = 50;

        // Bonus per keywords d'emissió
        if (dateKeywords.some(k => surrounding.includes(k))) score += 150;
        // Penalització per keywords de venciment/entrega
        if (skipKeywords.some(k => surrounding.includes(k))) score -= 200;

        // Bonus per any/mes que coincideix amb el path
        if (inferredYear && y === inferredYear) {
            score += 100;
            if (inferredMonth && m === inferredMonth) score += 400;
        }

        // [2.1B] Penalitzar dates dins de taules de línies de detall
        if (detailTableKeywords.some(k => surrounding.includes(k))) score -= 120;

        // [2.1B] Bonus per dates que apareixen a la part superior del text (header de la factura)
        const relativePosition = offset / Math.max(fullText.length, 1);
        if (relativePosition < 0.25) score += 80;   // Primer quart del document
        else if (relativePosition < 0.5) score += 30;
        else if (relativePosition > 0.8) score -= 40; // Molt avall (probablement peu de pàgina)

        dateCandidates.push({ fecha: fechaStr, score, surroundingText: surrounding, matchType: type, rawMatch: fullMatch });
    };

    // [2.1C] Detectar si el document és internacional (text en anglés, sense indicadors espanyols)
    const ltFull = fullText.toLowerCase();
    // Indicadors forts d'anglés: keywords exclusivament angleses (no comunes en docs espanyols)
    const englishIndicators = ['amount due', 'bill to', 'invoice date', 'due date', 'payment terms', 'remit to', 'purchase order'].filter(k => ltFull.includes(k)).length;
    // Indicadors d'espanyol: keywords espanyoles
    const spanishIndicators = ['factura', 'fecha', 'total a pagar', 'base imponible', 'emision', 'emisión', 'proveedor', 'cliente'].filter(k => ltFull.includes(k)).length;
    // Només considerar internacional si hi ha ≥2 indicadors anglesos i 0 espanyols
    const isInternational = englishIndicators >= 2 && spanishIndicators === 0;

    let dx;
    while ((dx = stdRegex.exec(fullText)) !== null) {
        if (dx[1]) {
            let d = parseInt(dx[1]), m = parseInt(dx[2]);
            const y = parseInt(dx[3]) < 100 ? 2000 + parseInt(dx[3]) : parseInt(dx[3]);
            // [2.1C] Desambiguació dd/mm vs mm/dd
            if (d <= 12 && m <= 12 && d !== m) {
                // Ambiguo: pot ser dd/mm (espanyol) o mm/dd (anglès)
                if (isInternational) {
                    // Format mm/dd/yyyy per documents internacionals
                    [d, m] = [m, d];
                }
                // Si no és internacional, assumim dd/mm/yyyy (format espanyol per defecte)
            } else if (d > 12 && m <= 12) {
                // Inequívoc: d > 12 vol dir que el primer és el dia segur (dd/mm)
                // No cal fer res
            } else if (m > 12 && d <= 12) {
                // Inequívoc: m > 12 vol dir que realment és mm/dd invertit → corregir
                [d, m] = [m, d];
            }
            processDateMatch(dx, 'std', d, m, y, dx[0]);
        }
        else processDateMatch(dx, 'std', parseInt(dx[6]), parseInt(dx[5]), parseInt(dx[4]), dx[0]);
    }
    while ((dx = longEsRegex.exec(fullText)) !== null) processDateMatch(dx, 'es', parseInt(dx[1]), getMonthNumber(dx[2], 'es'), parseInt(dx[3]), dx[0]);
    while ((dx = longEnRegex.exec(fullText)) !== null) processDateMatch(dx, 'en', parseInt(dx[2]), getMonthNumber(dx[1], 'en'), parseInt(dx[3]), dx[0]);

    // [2.1B] Si hi ha exactament 2 dates i una conté keyword de venciment → l'altra és emissió
    if (dateCandidates.length === 2) {
        const hasSkip0 = skipKeywords.some(k => dateCandidates[0].surroundingText?.includes(k));
        const hasSkip1 = skipKeywords.some(k => dateCandidates[1].surroundingText?.includes(k));
        if (hasSkip0 && !hasSkip1) dateCandidates[1].score += 300;
        else if (hasSkip1 && !hasSkip0) dateCandidates[0].score += 300;
    }

    // [2.1B] Detectar períodes de facturació ("del X al Y", "periodo: X - Y")
    const periodRegex = /(?:periodo|période|per[íi]odo|del)\s*:?\s*(\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4})\s*(?:[-–aA]l?\s*)\s*(\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4})/gi;
    let periodMatch;
    while ((periodMatch = periodRegex.exec(fullText)) !== null) {
        // Les dates de períodes NO són la data d'emissió — penalitzar-les
        for (const cand of dateCandidates) {
            if (cand.rawMatch === periodMatch[1] || cand.rawMatch === periodMatch[2]) {
                cand.score -= 150;
            }
        }
    }

    dateCandidates.sort((a, b) => b.score - a.score);
    let finalFecha = dateCandidates.length > 0 ? dateCandidates[0].fecha : (inferredYear ? `${inferredYear}-${String(inferredMonth || 1).padStart(2, '0')}-01` : new Date().toISOString().split('T')[0]);

    // --- 2. IMPORTS (millorat amb validació creuada) ---
    const totalKeywords = ['total', 'importe total', 'total a pagar', 'amount due', 'total amount', 'importe líquido', 'total factura', 'total fra', 'total eur', 'importe', 'suma total', 'neto a pagar', 'a pagar', 'import total'];
    const baseKeywords = ['base imponible', 'base imposable', 'subtotal', 'base', 'neto', 'importe neto', 'taxable amount'];
    const ivaKeywords = ['iva', 'vat', 'i.v.a', 'impuesto', 'tax', 'igic'];
    // Format 1: Europeu amb milers    "1.234,56" o "88,11"
    // Format 2: Anglès amb milers     "1,234.56" o "88.11"
    // Format 3: Sense separador milers "1234,56"  o "1234.56"
    const priceRegex = /\d{1,3}(?:\.\d{3})*,\d{2}|\d{1,3}(?:,\d{3})*\.\d{2}|\d+[,.]\d{2}/g;

    // [2.2D] parseAmount millorat per formats edge-case
    const parseAmount = (s) => {
        if (!s) return 0;
        let str = s.toString().trim();
        // Detectar negatiu al final ("1234.56-" → nota de crèdit)
        const negativeTrailing = str.endsWith('-');
        // Netejar símbols monetaris i espais
        str = str.replace(/[€$£¥\s]/g, '').replace(/EUR|USD|GBP/gi, '').replace(/-$/, '');
        const clean = str.replace(/[^\d.,-]/g, '');
        if (!clean) return 0;

        let result;
        if (clean.includes(',') && clean.includes('.')) {
            // Determinar quin és el separador decimal mirant l'últim
            const lastComma = clean.lastIndexOf(',');
            const lastDot = clean.lastIndexOf('.');
            if (lastComma > lastDot) {
                // Format europeu: 1.234,56
                result = parseFloat(clean.replace(/\./g, '').replace(',', '.'));
            } else {
                // Format anglès: 1,234.56
                result = parseFloat(clean.replace(/,/g, ''));
            }
        } else if (clean.includes(',')) {
            // Si la coma té exactament 2 dígits darrere → decimal
            const parts = clean.split(',');
            if (parts[parts.length - 1].length === 2) {
                result = parseFloat(clean.replace(',', '.'));
            } else {
                // Pot ser separador de milers (1,234) — treure coma
                result = parseFloat(clean.replace(/,/g, ''));
            }
        } else {
            result = parseFloat(clean);
        }

        return (negativeTrailing ? -1 : 1) * (isNaN(result) ? 0 : result);
    };

    // ============================================
    // FIX A: EXTRACCIÓ D'IMPORTS BASADA EN LÍNIES
    // Resol el problema de números fragmentats entre items del PDF
    // (p.ex. "67" + ",54" com items separats) escanejant les línies
    // reconstruïdes on els items ja estan units.
    // ============================================
    let lineBasedTotal = null;
    let lineBasedBase = null;
    let lineBasedVatPct = null;

    const extractAmountsFromLine = (lineText) => {
        // Normalitzar espais al voltant de separadors decimals fragmentats
        const normalized = lineText
            .replace(/(\d)\s+([,.])\s*(\d)/g, '$1$2$3')
            .replace(/(\d)\s*([,.])\s+(\d)/g, '$1$2$3');
        const matches = normalized.match(priceRegex);
        if (!matches) return [];
        return matches.map(m => parseAmount(m)).filter(v => v > 0 && v < 500000);
    };

    const lineTotalCandidates = [];
    const lineBaseCandidates = [];
    const totalLineCount = lines.length;

    lines.forEach((line, lineIndex) => {
        const lower = line.toLowerCase();
        const amounts = extractAmountsFromLine(line);
        if (amounts.length === 0) return;

        const lastAmount = amounts[amounts.length - 1];
        const hasTotal = totalKeywords.some(kw => lower.includes(kw));
        const hasBase = baseKeywords.some(kw => lower.includes(kw));
        const hasIva = ivaKeywords.some(kw => lower.includes(kw));
        const hasPct = lower.includes('%');

        // Posició: línies a la part inferior del document tenen més probabilitat de ser totals
        const positionRatio = totalLineCount > 1 ? lineIndex / (totalLineCount - 1) : 0.5;

        if (hasTotal && !hasIva && !hasPct) {
            let score = 300;
            if (positionRatio > 0.6) score += 100;
            lineTotalCandidates.push({ val: lastAmount, score, lineIndex });
            if (amounts.length > 1) {
                const firstAmount = amounts[0];
                if (firstAmount < lastAmount) {
                    lineBaseCandidates.push({ val: firstAmount, score: 50, lineIndex });
                }
            }
        }

        if (hasBase && !hasIva) {
            let score = 200;
            lineBaseCandidates.push({ val: lastAmount, score, lineIndex });
        }
    });

    // Cross-validar candidats basats en línies
    lineTotalCandidates.sort((a, b) => b.score - a.score);
    lineBaseCandidates.sort((a, b) => b.score - a.score);

    if (lineTotalCandidates.length > 0 && lineBaseCandidates.length > 0) {
        for (const tc of lineTotalCandidates.slice(0, 5)) {
            for (const bc of lineBaseCandidates.slice(0, 8)) {
                if (bc.val >= tc.val) continue;
                const diff = tc.val - bc.val;
                for (const vatPct of [21, 10, 4, 0]) {
                    if (Math.abs(bc.val * (vatPct / 100) - diff) < 0.10) {
                        lineBasedTotal = tc.val;
                        lineBasedBase = bc.val;
                        lineBasedVatPct = vatPct;
                        console.log(`[pdfScanner] ✓ Line-based cross-val: Base ${bc.val} + IVA ${vatPct}% = Total ${tc.val}`);
                        break;
                    }
                }
                if (lineBasedBase !== null) break;
            }
            if (lineBasedBase !== null) break;
        }
    }

    // FIX 3: Si tenim total per línies però no base, buscar base entre TOTS els imports del document
    // Soluciona: "Total 106,61 EUR" detectat però "88,11 EUR" no té keyword de base a la seva línia
    if (lineBasedBase === null && lineTotalCandidates.length > 0) {
        const allLineAmounts = [];
        lines.forEach(line => {
            extractAmountsFromLine(line).forEach(v => { if (v > 0 && v < 500000) allLineAmounts.push(v); });
        });
        // Eliminar duplicats i ordenar descendent
        const uniqueAmounts = [...new Set(allLineAmounts)].sort((a, b) => b - a);
        for (const tc of lineTotalCandidates.slice(0, 3)) {
            for (const baseVal of uniqueAmounts) {
                if (baseVal >= tc.val) continue;
                const diff = tc.val - baseVal;
                for (const vatPct of [21, 10, 4, 0]) {
                    if (Math.abs(baseVal * (vatPct / 100) - diff) < 0.10) {
                        lineBasedTotal = tc.val;
                        lineBasedBase = baseVal;
                        lineBasedVatPct = vatPct;
                        console.log(`[pdfScanner] ✓ Line-total+scan: Base ${baseVal} + IVA ${vatPct}% = Total ${tc.val}`);
                        break;
                    }
                }
                if (lineBasedBase !== null) break;
            }
            if (lineBasedBase !== null) break;
        }
    }

    let amountCandidates = [];
    metadataItems.forEach(item => {
        const matches = item.str.match(priceRegex);
        if (matches) {
            matches.forEach(m => {
                const val = parseAmount(m);
                if (val > 0 && val < 500000) { // Límit generós per cobrir factures grans
                    let score = 0, type = 'unknown';

                    // FIX B: Bonus de font reduïts per evitar que línies de detall negreta superin totals
                    if (item.isBold) score += 100;
                    if (item.height > 10.5) score += 70;
                    if (item.height > 14) score += 80;

                    // Context horitzontal
                    const hCtx = metadataItems.filter(o =>
                        Math.abs(o.y - item.y) < 12 && Math.abs(o.x - item.x) < 300
                    ).map(o => o.str.toLowerCase()).join(' ');

                    // Context vertical (columna superior)
                    const vCtx = metadataItems.filter(o =>
                        Math.abs(o.x - item.x) < 60 && o.y > item.y && o.y - item.y < 80
                    ).map(o => o.str.toLowerCase()).join(' ');

                    const ctx = hCtx + ' ' + vCtx;

                    if (totalKeywords.some(kw => ctx.includes(kw))) { score += 250; type = 'total'; }
                    if (baseKeywords.some(kw => ctx.includes(kw))) { score += 80; type = type === 'total' ? type : 'base'; }

                    // FIX 1: PRIORITAT DEL CONTEXT VERTICAL (mateixa columna)
                    // Soluciona: "88,11 EUR" als detecta com 'total' perquè "Total" és
                    // a ±300px horitzontal, tot i que "Base Imponible" és a la columna de sobre.
                    // La columna vertical (±60px X) identifica l'estructura de la taula.
                    const baseInVertical = baseKeywords.some(kw => vCtx.includes(kw));
                    const totalInVertical = totalKeywords.some(kw => vCtx.includes(kw));
                    if (baseInVertical && !totalInVertical) {
                        type = 'base'; // Columna amb "Base Imponible" al capçal → és base
                    } else if (totalInVertical && !baseInVertical && type !== 'total') {
                        type = 'total'; // Columna amb "Total" al capçal → confirmar 'total'
                    }

                    // FIX B: Penalitzacions IVA/% reforçades
                    if (ivaKeywords.some(kw => ctx.includes(kw)) && type !== 'total') { score -= 150; type = type === 'base' ? type : 'iva'; }
                    if (ctx.includes('%') && type !== 'total' && type !== 'base') score -= 200;
                    // FIX B: Penalització per imports iguals a tipus IVA comuns prop de context IVA/%
                    if ([4.00, 10.00, 21.00].includes(val) && (ivaKeywords.some(kw => ctx.includes(kw)) || ctx.includes('%')) && type !== 'base') {
                        score -= 200;
                    }
                    if (ctx.includes('unit') || ctx.includes('precio') || ctx.includes('p.u')) score -= 120;
                    if (ctx.includes('descuento') || ctx.includes('dto')) score -= 100;
                    if (val < 1) score -= 100;
                    // FIX B: Bonus posició (y baix = part inferior del document = on solen estar els totals)
                    if (item.y < 200) score += 80;
                    else if (item.y < 300) score += 40;
                    // FIX 3: Bonus per símbol/codi de moneda adjacent (indica clarament import monetari)
                    const hasCurrencyNearby = metadataItems.some(o =>
                        Math.abs(o.y - item.y) < 8 && Math.abs(o.x - item.x) < 100 &&
                        /[€$£¥]|EUR|USD|GBP|CHF/i.test(o.str)
                    );
                    if (hasCurrencyNearby) score += 120;

                    amountCandidates.push({ val, score, y: item.y, x: item.x, type });
                }
            });
        }
    });

    amountCandidates.sort((a, b) => b.score - a.score || a.y - b.y);

    // Validació creuada Base + IVA = Total
    // FIX B: Llindar reduït (150 vs 200) i pool expandit (5×8 vs 3×5)
    const totalCands = amountCandidates.filter(c => c.type === 'total' || c.score > 150);
    const baseCands = amountCandidates.filter(c => c.type === 'base');

    let detectedTotal = amountCandidates.length > 0 ? amountCandidates[0].val : 0;
    let validatedBase = null, validatedVatPercent = null;

    if (totalCands.length > 0 && baseCands.length > 0) {
        for (const tc of totalCands.slice(0, 5)) {
            for (const bc of baseCands.slice(0, 8)) {
                if (bc.val >= tc.val) continue;
                const diff = tc.val - bc.val;
                for (const vatPct of [21, 10, 4, 0]) {
                    if (Math.abs(bc.val * (vatPct / 100) - diff) < 0.05) {
                        detectedTotal = tc.val; validatedBase = bc.val; validatedVatPercent = vatPct;
                        console.log(`[pdfScanner] ✓ Cross-val: Base ${bc.val} + IVA ${vatPct}% = Total ${tc.val}`);
                        break;
                    }
                }
                if (validatedBase !== null) break;
            }
            if (validatedBase !== null) break;
        }
    }

    // FIX A (continuació): Si la cross-validació metadata ha fallat, usar resultats de línies
    if (validatedBase === null && lineBasedBase !== null) {
        detectedTotal = lineBasedTotal;
        validatedBase = lineBasedBase;
        validatedVatPercent = lineBasedVatPct;
        console.log(`[pdfScanner] ✓ Using line-based extraction: Base ${validatedBase} + IVA ${validatedVatPercent}% = Total ${detectedTotal}`);
    }

    // FIX 2: CROSS-VALIDACIÓ EXPANDIDA — prova TOTS els parells de candidats independentment del tipus
    // Safety net definitiu: soluciona casos on baseCands és buit (tots marcats 'total' per context ample)
    if (validatedBase === null && amountCandidates.length >= 2) {
        const sortedByScore = [...amountCandidates].sort((a, b) => b.score - a.score);
        let found = false;
        for (let i = 0; i < Math.min(10, sortedByScore.length) && !found; i++) {
            const tc = sortedByScore[i];
            // Només intentar com a total si té puntuació reasonable o context de total
            if (tc.score < 100 && tc.type !== 'total') continue;
            for (let j = 0; j < sortedByScore.length && !found; j++) {
                const bc = sortedByScore[j];
                if (bc === tc || bc.val >= tc.val || bc.val <= 0) continue;
                const diff = tc.val - bc.val;
                for (const vatPct of [21, 10, 4, 0]) {
                    if (Math.abs(bc.val * (vatPct / 100) - diff) < 0.10) {
                        detectedTotal = tc.val;
                        validatedBase = bc.val;
                        validatedVatPercent = vatPct;
                        console.log(`[pdfScanner] ✓ Expanded cross-val: Base ${bc.val} + IVA ${vatPct}% = Total ${tc.val}`);
                        found = true;
                        break;
                    }
                }
            }
        }
    }

    // Fallback: via IVA candidates
    if (validatedBase === null && totalCands.length > 0) {
        const ivaCands = amountCandidates.filter(c => c.type === 'iva');
        for (const tc of totalCands.slice(0, 3)) {
            for (const ic of ivaCands.slice(0, 5)) {
                const impliedBase = tc.val - ic.val;
                if (impliedBase <= 0 || impliedBase >= tc.val) continue;
                for (const vatPct of [21, 10, 4]) {
                    if (Math.abs(impliedBase * (vatPct / 100) - ic.val) < 0.05) {
                        detectedTotal = tc.val; validatedBase = impliedBase; validatedVatPercent = vatPct;
                        console.log(`[pdfScanner] ✓ Via IVA: Total ${tc.val} - IVA ${ic.val} = Base ${impliedBase.toFixed(2)}`);
                        break;
                    }
                }
                if (validatedBase !== null) break;
            }
            if (validatedBase !== null) break;
        }
    }

    // [2.2A] Suport per IVA mixt (múltiples línies IVA a la mateixa factura)
    let mixedVatDetected = false;
    let mixedVatLines = [];
    const ivaLineRegex = /iva\s*(\d{1,2})\s*%?\s*[:\s]*(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:\.\d{2}))/gi;
    let ivaLineMatch;
    while ((ivaLineMatch = ivaLineRegex.exec(cleanText)) !== null) {
        mixedVatLines.push({ percent: parseInt(ivaLineMatch[1]), amount: parseAmount(ivaLineMatch[2]) });
    }
    if (mixedVatLines.length > 1 && validatedBase === null) {
        const totalMixedIva = mixedVatLines.reduce((sum, l) => sum + l.amount, 0);
        // Buscar un total candidat on base + totalIva ≈ total
        for (const tc of totalCands.slice(0, 3)) {
            const impliedBase = tc.val - totalMixedIva;
            if (impliedBase > 0 && impliedBase < tc.val && Math.abs(impliedBase + totalMixedIva - tc.val) < 0.10) {
                // Verificar coherència bàsica: cap línia ha de tindre IVA 0% amb import > 0
                let coherent = true;
                for (const line of mixedVatLines) {
                    if (line.percent === 0 && line.amount > 0) coherent = false;
                }
                if (coherent) {
                    detectedTotal = tc.val;
                    validatedBase = impliedBase;
                    // Utilitzar el tipus IVA predominant (el de major import)
                    mixedVatLines.sort((a, b) => b.amount - a.amount);
                    validatedVatPercent = mixedVatLines[0].percent;
                    mixedVatDetected = true;
                    console.log(`[pdfScanner] ✓ IVA mixt detectat: ${mixedVatLines.map(l => `${l.percent}%=${l.amount}`).join(' + ')} | Base ${impliedBase.toFixed(2)} | Total ${tc.val}`);
                    break;
                }
            }
        }
    }

    // [2.2B] Suport per IRPF retingut en factures de serveis
    let detectedIrpf = null;
    const irpfRegex = /(?:retenci[oó]n|irpf)\s*[-:]?\s*(\d{1,2})\s*%?\s*[-:]?\s*-?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:\.\d{2}))/gi;
    let irpfMatch;
    while ((irpfMatch = irpfRegex.exec(cleanText)) !== null) {
        const irpfPercent = parseInt(irpfMatch[1]);
        const irpfAmount = parseAmount(irpfMatch[2]);
        if (irpfPercent > 0 && irpfPercent <= 25 && irpfAmount > 0) {
            detectedIrpf = { percent: irpfPercent, amount: irpfAmount };
            break;
        }
    }
    // Si hi ha IRPF, ajustar cross-validation: base + iva - irpf = total
    if (detectedIrpf && validatedBase === null && totalCands.length > 0) {
        for (const tc of totalCands.slice(0, 3)) {
            for (const vatPct of [21, 10, 4, 0]) {
                // total = base + (base * iva%) - (base * irpf%)
                // total = base * (1 + iva/100 - irpf/100)
                const factor = 1 + vatPct / 100 - detectedIrpf.percent / 100;
                if (factor <= 0) continue;
                const impliedBase = tc.val / factor;
                const expectedIrpf = impliedBase * (detectedIrpf.percent / 100);
                if (Math.abs(expectedIrpf - detectedIrpf.amount) < 0.10) {
                    detectedTotal = tc.val;
                    validatedBase = impliedBase;
                    validatedVatPercent = vatPct;
                    console.log(`[pdfScanner] ✓ IRPF detectat: Base ${impliedBase.toFixed(2)} + IVA ${vatPct}% - IRPF ${detectedIrpf.percent}% (${detectedIrpf.amount}) = Total ${tc.val}`);
                    break;
                }
            }
            if (validatedBase !== null) break;
        }
    }

    // [2.2C] Suport per recàrrec d'equivalència (R.E.)
    // Nota: Evitem "r.e." sol perquè fa match amb "reference", "rent", etc.
    // Requerim "recargo equivalencia" complet o "r.e." precedit per IVA/base/recargo context
    let detectedRE = null;
    const reRegex = /(?:recargo?\s*(?:de\s*)?equivalencia|recargo\s*equiv\.?)\s*[-:]?\s*(\d{1,2}(?:[,.]\d{1,2})?)\s*%?\s*[-:]?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:\.\d{2}))?/gi;
    let reMatch;
    while ((reMatch = reRegex.exec(cleanText)) !== null) {
        const rePct = parseFloat(reMatch[1].replace(',', '.'));
        const reAmount = reMatch[2] ? parseAmount(reMatch[2]) : null;
        if (rePct > 0 && rePct <= 10) {
            detectedRE = { percent: rePct, amount: reAmount };
            break;
        }
    }
    if (detectedRE && validatedBase === null && totalCands.length > 0) {
        for (const tc of totalCands.slice(0, 3)) {
            for (const vatPct of [21, 10, 4]) {
                // total = base + (base * iva%) + (base * re%)
                const factor = 1 + vatPct / 100 + detectedRE.percent / 100;
                const impliedBase = tc.val / factor;
                if (impliedBase > 0 && impliedBase < tc.val) {
                    const expectedRE = detectedRE.amount || (impliedBase * detectedRE.percent / 100);
                    if (!detectedRE.amount || Math.abs(impliedBase * detectedRE.percent / 100 - expectedRE) < 0.10) {
                        detectedTotal = tc.val;
                        validatedBase = impliedBase;
                        validatedVatPercent = vatPct;
                        console.log(`[pdfScanner] ✓ R.E. detectat: Base ${impliedBase.toFixed(2)} + IVA ${vatPct}% + RE ${detectedRE.percent}% = Total ${tc.val}`);
                        break;
                    }
                }
            }
            if (validatedBase !== null) break;
        }
    }

    // --- 3. PROVEÏDOR ---
    const legalSuffixes = /\b(S\.?L\.?|S\.?L\.?U\.?|S\.?A\.?|Limitada|Anónima|Inc|Corp|GmbH|Ltd)\b/i;
    const ignoreWords = ['factura', 'invoice', 'recibo', 'receipt', 'cliente', 'customer', 'vendedor', 'bill to', 'página', 'page', 'nif', 'cif', 'fecha', 'date', 'tel', 'email', 'www'];

    // [2.3A] Construir conjunt robust de termes propis a filtrar
    const userFilterTerms = new Set(userNameParts); // Paraules del nom amb >2 chars
    const userIban = (config.iban || '').replace(/\s/g, '').toUpperCase();
    const userEmail = (config.email || '').toLowerCase();
    const userAddress = (config.direccion || '').toLowerCase().substring(0, 30);
    const userNombre = (config.nombre || '').toLowerCase();
    // Afegir paraules de l'adreça amb >4 chars (evitar filtrar paraules genèriques curtes)
    if (userAddress) {
        userAddress.split(/[\s,]+/).filter(p => p.length > 4).forEach(p => userFilterTerms.add(p));
    }

    let supplierCandidates = [];
    metadataItems.forEach(item => {
        const str = item.str.trim();
        if (str.length < 3 || str.length > 80) return;
        const lower = str.toLowerCase();
        if (lower.includes(userNif.toLowerCase())) return;
        // [2.3A] Filtrar si conté paraules del nom, email o IBAN de l'usuari
        if ([...userFilterTerms].some(part => lower.includes(part))) return;
        if (userEmail && lower.includes(userEmail)) return;
        if (userIban && str.replace(/\s/g, '').toUpperCase().includes(userIban.substring(0, 10))) return;
        if (ignoreWords.some(w => lower.includes(w) && str.length < 20)) return;

        let score = 0;
        if (item.isBold) score += 250;
        if (item.height > 10.5) score += 100;
        if (item.height > 15) score += 150;
        if (item.y > 600) score += 150;
        if (item.y > 750) score += 200;
        if (legalSuffixes.test(str)) score += 400;
        if (foundDomains.some(d => str.includes(d))) score += 500;
        if (/\d{5}/.test(str)) score -= 200;
        if (/c\/|calle|avda|vía/i.test(str)) score -= 300;

        supplierCandidates.push({ str, score, y: item.y, x: item.x });
    });

    if (foundDomains.length > 0 && (supplierCandidates.length === 0 || supplierCandidates[0].score < 300)) {
        foundDomains.forEach(d => supplierCandidates.push({ str: d, score: 600, y: 0, x: 0 }));
    }

    // [2.3B] Detectar emissor vs receptor via patrons explícits
    const emissorKeywords = ['emisor', 'de:', 'from:', 'vendedor:', 'proveedor:', 'seller:', 'datos del emisor', 'datos empresa'];
    const receptorKeywords = ['cliente:', 'para:', 'to:', 'destinatario:', 'bill to:', 'facturar a:', 'ship to:', 'datos del cliente', 'datos cliente'];

    // Buscar blocs d'emissor i receptor al text complet
    const ltClean = cleanText.toLowerCase();
    let emissorZone = null, receptorZone = null;
    for (const ek of emissorKeywords) {
        const idx = ltClean.indexOf(ek);
        if (idx !== -1) { emissorZone = cleanText.substring(idx, Math.min(idx + 200, cleanText.length)); break; }
    }
    for (const rk of receptorKeywords) {
        const idx = ltClean.indexOf(rk);
        if (idx !== -1) { receptorZone = cleanText.substring(idx, Math.min(idx + 200, cleanText.length)); break; }
    }

    // Si el NIF de l'usuari apareix a la zona "receptor", donar bonus a candidats de la zona "emissor"
    if (receptorZone && receptorZone.toLowerCase().includes(userNif.toLowerCase()) && emissorZone) {
        const emissorLower = emissorZone.toLowerCase();
        supplierCandidates.forEach(cand => {
            if (emissorLower.includes(cand.str.toLowerCase())) {
                cand.score += 350; // Fort bonus per estar a la zona emissor
            }
        });
    }

    // [2.3C] Millorar matching per plataformes de pagament
    const paymentPlatforms = ['stripe', 'paypal', 'bizum', 'square', 'wise', 'transferwise', 'revolut'];
    const merchantKeywords = ['comercio:', 'merchant:', 'vendedor:', 'establecimiento:', 'nombre comercial:', 'company:', 'seller:'];
    const topSupplier = supplierCandidates.length > 0 ? supplierCandidates.sort((a, b) => b.score - a.score)[0] : null;
    if (topSupplier && paymentPlatforms.some(p => topSupplier.str.toLowerCase().includes(p))) {
        // Buscar el nom real del comerciant dins del text
        for (const mk of merchantKeywords) {
            const idx = ltClean.indexOf(mk);
            if (idx !== -1) {
                const afterKeyword = cleanText.substring(idx + mk.length, idx + mk.length + 80).trim();
                const merchantName = afterKeyword.split(/[\n\r,|]/)[0].trim();
                if (merchantName && merchantName.length >= 3 && merchantName.length <= 60) {
                    supplierCandidates.push({ str: merchantName, score: 700, y: 0, x: 0 });
                    console.log(`[pdfScanner] 🏪 Plataforma ${topSupplier.str} → comerciant real: ${merchantName}`);
                    break;
                }
            }
        }
    }

    supplierCandidates.sort((a, b) => b.score - a.score || b.y - a.y);

    let finalProveedor = 'Proveedor Desconocido';
    if (supplierCandidates.length > 0) {
        let candidate = supplierCandidates[0].str;
        finalProveedor = candidate.split(/,|\b\d{5}\b|C\/|Calle|Avda|Avenida|Tel:|NIF:|CIF:/i)[0]
            .replace(/[^\w\s\.&À-ÿ]/g, '').replace(/\s+/g, ' ').trim();
        if (finalProveedor.length < 3 && supplierCandidates.length > 1)
            finalProveedor = supplierCandidates[1].str.split(/,/)[0].replace(/[^\w\s\.&À-ÿ]/g, '').trim();
    }
    if (finalProveedor.length > 60) finalProveedor = finalProveedor.substring(0, 60);

    // --- 3.1 CIF/NIF ---
    const detectedCifNif = detectProviderCifNif(cleanText, userNif);

    // --- 3.2 CATEGORIA + IVA + CIF (pipeline amb regles avançades) ---
    let finalCategoria = 'Otros';
    let categorySource = 'default';
    let finalCifNif = detectedCifNif;
    let finalConcepto = 'Gasto importado';
    let finalDeducible = true;
    let finalDeduciblePct = null;
    let ruleApplied = null;

    // --- 4. IVA (detecció automàtica) ---
    const commonVats = [21, 10, 4, 0];
    let detectedVatPercent = validatedVatPercent !== null ? validatedVatPercent : 21;
    let vatFoundInText = validatedVatPercent !== null;

    if (!vatFoundInText) {
        const vatKws = ['iva', 'vat', 'tax', 'impuesto', 'tipo', 'i.v.a'];
        const lt = cleanText.toLowerCase();
        for (const kw of vatKws) {
            const idx = lt.indexOf(kw);
            if (idx !== -1) {
                const look = cleanText.substring(idx, idx + 25);
                const nm = look.match(/\b(21|10|4|0)\s*%?/);
                if (nm && commonVats.includes(parseInt(nm[1]))) {
                    detectedVatPercent = parseInt(nm[1]); vatFoundInText = true; break;
                }
            }
        }
    }
    if (!vatFoundInText) {
        const pctRegex = /(\d{1,2})\s*%/g;
        const pctSkipContext = ['descuento', 'dto', 'retencion', 'retención', 'irpf', 'cobro', 'comision', 'comisión', 'recargo'];
        let px;
        while ((px = pctRegex.exec(cleanText)) !== null) {
            const val = parseInt(px[1]);
            if (!commonVats.includes(val)) continue;
            // Verificar que no estigui en context de descompte, retenció, etc.
            const pctSurr = cleanText.substring(Math.max(0, px.index - 40), px.index + 20).toLowerCase();
            if (pctSkipContext.some(sk => pctSurr.includes(sk))) continue;
            detectedVatPercent = val; vatFoundInText = true; break;
        }
    }

    // Base imponible (auto-detect)
    let finalBaseImponible = validatedBase !== null
        ? validatedBase
        : detectedTotal / (1 + detectedVatPercent / 100);

    // Fallback cross-ref
    if (validatedBase === null) {
        for (const cand of amountCandidates) {
            if (cand.val < detectedTotal && cand.val > detectedTotal * 0.4) {
                for (const v of (vatFoundInText ? [detectedVatPercent] : commonVats)) {
                    if (Math.abs(cand.val * (1 + v / 100) - detectedTotal) < 0.2) {
                        finalBaseImponible = cand.val; detectedVatPercent = v; vatFoundInText = true; break;
                    }
                }
                if (vatFoundInText) break;
            }
        }
    }

    // ============================================
    // MOTOR DE REGLES AVANÇADES (Prioritat Màxima)
    // Regla de l'usuari > CIF match > Memòria > Expenses existents > Keywords
    // ============================================

    // Camp source per a badges de confiança
    const fieldSources = {};

    if (providerMemory) {
        // --- PRIORITAT 0: Regles avançades de l'usuari ---
        const ruleResult = providerMemory.applyAdvancedRules({
            proveedor: finalProveedor,
            concepto: finalConcepto,
            filename: context.filename || '',
            rawText: cleanText,
            cif: finalCifNif,
        });

        if (ruleResult) {
            const a = ruleResult.actions;
            ruleApplied = ruleResult.ruleName;

            if (a.proveedor) { finalProveedor = a.proveedor; fieldSources.proveedor = 'rule'; }
            if (a.categoria) { finalCategoria = a.categoria; categorySource = 'rule'; fieldSources.categoria = 'rule'; }
            if (a.cifNif) { finalCifNif = a.cifNif; fieldSources.cifProveedor = 'rule'; }
            if (a.concepto) { finalConcepto = a.concepto; fieldSources.concepto = 'rule'; }
            if (a.deducible !== null && a.deducible !== undefined) { finalDeducible = a.deducible; fieldSources.deducible = 'rule'; }
            if (a.deduciblePct !== null && a.deduciblePct !== undefined) { finalDeduciblePct = a.deduciblePct; fieldSources.deduciblePct = 'rule'; }
            if (a.ivaPorcentaje !== null && a.ivaPorcentaje !== undefined) {
                detectedVatPercent = a.ivaPorcentaje;
                // Recalcular base si forcem IVA
                if (detectedVatPercent === 0) {
                    finalBaseImponible = detectedTotal;
                } else {
                    finalBaseImponible = detectedTotal / (1 + detectedVatPercent / 100);
                }
                fieldSources.ivaPorcentaje = 'rule';
            }

            // Estratègia de data
            if (a.dateStrategy) {
                const newDate = applyDateStrategy(dateCandidates, a.dateStrategy, {
                    fallbackDate: finalFecha,
                });
                if (newDate) { finalFecha = newDate; fieldSources.fecha = 'rule'; }
            }

            console.log(`[pdfScanner] ⚡ Regla aplicada: "${ruleResult.ruleName}" → prov:${a.proveedor || '-'} cat:${a.categoria || '-'} iva:${a.ivaPorcentaje ?? '-'}`);
        }

        // --- PRIORITAT 0.5: Matching per CIF/NIF ---
        if (categorySource !== 'rule' && finalCifNif) {
            const cifMatch = providerMemory.findByCif(finalCifNif);
            if (cifMatch) {
                if (!fieldSources.proveedor) { finalProveedor = cifMatch.originalName; fieldSources.proveedor = 'cif_match'; }
                if (!fieldSources.categoria && cifMatch.categoria) { finalCategoria = cifMatch.categoria; categorySource = 'cif_match'; fieldSources.categoria = 'cif_match'; }
                if (!fieldSources.ivaPorcentaje && cifMatch.ivaPorcentaje !== null && cifMatch.ivaPorcentaje !== undefined) {
                    detectedVatPercent = cifMatch.ivaPorcentaje;
                    finalBaseImponible = detectedTotal / (1 + detectedVatPercent / 100);
                    fieldSources.ivaPorcentaje = 'cif_match';
                }
                console.log(`[pdfScanner] 🔑 CIF match: "${finalCifNif}" → ${finalProveedor}`);
            }
        }

        // --- PRIORITAT 1: Memòria de proveïdors ---
        if (categorySource === 'default' || categorySource === 'keywords') {
            const memorized = providerMemory.findProvider(finalProveedor);
            if (memorized && memorized.matchScore >= 55) {
                if (!fieldSources.categoria && memorized.categoria) {
                    finalCategoria = memorized.categoria;
                    categorySource = `memory (${memorized.matchType}, score:${memorized.matchScore})`;
                    fieldSources.categoria = 'memory';
                }
                if (!fieldSources.cifProveedor && memorized.cifNif) { finalCifNif = memorized.cifNif; fieldSources.cifProveedor = 'memory'; }
                if (!fieldSources.ivaPorcentaje && memorized.ivaPorcentaje !== null && memorized.ivaPorcentaje !== undefined) {
                    detectedVatPercent = memorized.ivaPorcentaje;
                    finalBaseImponible = detectedTotal / (1 + detectedVatPercent / 100);
                    fieldSources.ivaPorcentaje = 'memory';
                }
                console.log(`[pdfScanner] 🧠 Memòria: "${finalProveedor}" → ${finalCategoria}`);
            }
        }
    }

    // --- PRIORITAT 2: Proveïdors existents ---
    if (categorySource === 'default') {
        const known = matchKnownProvider(finalProveedor, existingExpenses);
        if (known && known.categoria) {
            finalCategoria = known.categoria;
            categorySource = 'existing_expenses';
            fieldSources.categoria = 'existing';
            if (!finalCifNif && known.cifProveedor) finalCifNif = known.cifProveedor;
        }
    }

    // --- PRIORITAT 3: Keywords ---
    if (categorySource === 'default') {
        finalCategoria = detectCategoryByKeywords(cleanText);
        categorySource = 'keywords';
        fieldSources.categoria = 'auto';
    }

    // --- FIX 4: DETECCIÓ DE MONEDA ---
    // Comptar ocurrències de cada codi/símbol de moneda al text per seleccionar la predominant
    let detectedMoneda = 'EUR'; // Default per a autònoms espanyols
    const monedaPatterns = [
        { code: 'EUR', regex: /\bEUR\b|€/g },
        { code: 'USD', regex: /\bUSD\b|\bUS\$|\$/g },
        { code: 'GBP', regex: /\bGBP\b|£/g },
        { code: 'CHF', regex: /\bCHF\b/g },
        { code: 'JPY', regex: /\bJPY\b|¥/g },
        { code: 'MXN', regex: /\bMXN\b/g },
        { code: 'BRL', regex: /\bBRL\b/g },
        { code: 'ARS', regex: /\bARS\b/g },
    ];
    let maxMonedaCount = 0;
    for (const { code, regex } of monedaPatterns) {
        const matches = cleanText.match(regex);
        const count = matches ? matches.length : 0;
        if (count > maxMonedaCount) { maxMonedaCount = count; detectedMoneda = code; }
    }

    return {
        fecha: finalFecha,
        proveedor: finalProveedor || 'Proveedor Desconocido',
        cifProveedor: finalCifNif || '',
        concepto: finalConcepto,
        categoria: finalCategoria,
        categorySource,
        baseImponible: finalBaseImponible,
        ivaPorcentaje: detectedVatPercent,
        total: detectedTotal,
        moneda: detectedMoneda,
        deducible: finalDeducible,
        deduciblePct: finalDeduciblePct,
        ruleApplied,
        fieldSources,
        // [Fase 2] Dades addicionals d'extracció
        irpfDetected: detectedIrpf,          // { percent, amount } o null
        recargoEquivalencia: detectedRE,     // { percent, amount } o null
        mixedVat: mixedVatDetected ? mixedVatLines : null,  // [{ percent, amount }] o null
    };
};

// ============================================
// ESTRATÈGIA DE DATA (per regles avançades)
// ============================================

const applyDateStrategy = (dateCandidates, strategy, context) => {
    if (!dateCandidates || dateCandidates.length === 0) return context.fallbackDate;

    let candidates = [...dateCandidates];

    // Filtrar dates amb keywords a evitar
    if (strategy.skipKeywords?.length) {
        const filtered = candidates.filter(c =>
            !strategy.skipKeywords.some(sk =>
                c.surroundingText?.toLowerCase().includes(sk.toLowerCase())
            )
        );
        // Només filtrar si queden candidats
        if (filtered.length > 0) candidates = filtered;
    }

    // Preferència per keyword específic
    if (strategy.prefer === 'nearest_to_keyword' && strategy.keyword) {
        candidates.sort((a, b) => {
            const aHas = a.surroundingText?.toLowerCase().includes(strategy.keyword.toLowerCase());
            const bHas = b.surroundingText?.toLowerCase().includes(strategy.keyword.toLowerCase());
            if (aHas && !bHas) return -1;
            if (bHas && !aHas) return 1;
            return b.score - a.score;
        });
    }

    // Primera o última data cronològicament
    if (strategy.prefer === 'first') candidates.sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (strategy.prefer === 'last') candidates.sort((a, b) => b.fecha.localeCompare(a.fecha));

    let result = candidates[0]?.fecha || context.fallbackDate;

    // Forçar dia del mes
    if (strategy.dayOfMonth && result) {
        const parts = result.split('-');
        if (parts.length === 3) {
            result = `${parts[0]}-${parts[1]}-${String(strategy.dayOfMonth).padStart(2, '0')}`;
        }
    }

    return result;
};
