
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
                            existingExpenses: config.existingExpenses || []
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
    const processDateMatch = (match, type, d, m, y, fullMatch) => {
        if (!m || d < 1 || d > 31 || m < 1 || m > 12 || y < 2010 || y > 2100) return;
        const fechaStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const offset = fullText.indexOf(fullMatch);
        const surrounding = fullText.substring(Math.max(0, offset - 60), Math.min(fullText.length, offset + 60)).toLowerCase();
        let score = 50;
        if (dateKeywords.some(k => surrounding.includes(k))) score += 150;
        if (skipKeywords.some(k => surrounding.includes(k))) score -= 200;
        if (inferredYear && y === inferredYear) {
            score += 100;
            if (inferredMonth && m === inferredMonth) score += 400;
        }
        dateCandidates.push({ fecha: fechaStr, score });
    };

    let dx;
    while ((dx = stdRegex.exec(fullText)) !== null) {
        if (dx[1]) processDateMatch(dx, 'std', parseInt(dx[1]), parseInt(dx[2]), parseInt(dx[3]) < 100 ? 2000 + parseInt(dx[3]) : parseInt(dx[3]), dx[0]);
        else processDateMatch(dx, 'std', parseInt(dx[6]), parseInt(dx[5]), parseInt(dx[4]), dx[0]);
    }
    while ((dx = longEsRegex.exec(fullText)) !== null) processDateMatch(dx, 'es', parseInt(dx[1]), getMonthNumber(dx[2], 'es'), parseInt(dx[3]), dx[0]);
    while ((dx = longEnRegex.exec(fullText)) !== null) processDateMatch(dx, 'en', parseInt(dx[2]), getMonthNumber(dx[1], 'en'), parseInt(dx[3]), dx[0]);

    dateCandidates.sort((a, b) => b.score - a.score);
    let finalFecha = dateCandidates.length > 0 ? dateCandidates[0].fecha : (inferredYear ? `${inferredYear}-${String(inferredMonth || 1).padStart(2, '0')}-01` : new Date().toISOString().split('T')[0]);

    // --- 2. IMPORTS (millorat amb validació creuada) ---
    const totalKeywords = ['total', 'importe total', 'total a pagar', 'amount due', 'total amount', 'importe líquido', 'total factura', 'total fra', 'total eur', 'importe', 'suma total', 'neto a pagar', 'a pagar', 'import total'];
    const baseKeywords = ['base imponible', 'base imposable', 'subtotal', 'base', 'neto', 'importe neto', 'taxable amount'];
    const ivaKeywords = ['iva', 'vat', 'i.v.a', 'impuesto', 'tax', 'igic'];
    const priceRegex = /\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:\.\d{2})/g;

    const parseAmount = (s) => {
        const clean = s.replace(/[^\d.,]/g, '');
        if (clean.includes(',') && clean.includes('.')) return parseFloat(clean.replace(/\./g, '').replace(',', '.'));
        if (clean.includes(',')) return parseFloat(clean.replace(',', '.'));
        return parseFloat(clean);
    };

    let amountCandidates = [];
    metadataItems.forEach(item => {
        const matches = item.str.match(priceRegex);
        if (matches) {
            matches.forEach(m => {
                const val = parseAmount(m);
                if (val > 0 && val < 50000) {
                    let score = 0, type = 'unknown';

                    if (item.isBold) score += 150;
                    if (item.height > 10.5) score += 100;
                    if (item.height > 14) score += 100;

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
                    if (ivaKeywords.some(kw => ctx.includes(kw)) && type !== 'total') { score -= 50; type = 'iva'; }
                    if (ctx.includes('%') && type !== 'total') score -= 80;
                    if (ctx.includes('unit') || ctx.includes('precio') || ctx.includes('p.u')) score -= 120;
                    if (ctx.includes('descuento') || ctx.includes('dto')) score -= 100;
                    if (val < 1) score -= 100;
                    if (item.y < 200 && type === 'total') score += 50;

                    amountCandidates.push({ val, score, y: item.y, x: item.x, type });
                }
            });
        }
    });

    amountCandidates.sort((a, b) => b.score - a.score || a.y - b.y);

    // Validació creuada Base + IVA = Total
    const totalCands = amountCandidates.filter(c => c.type === 'total' || c.score > 200);
    const baseCands = amountCandidates.filter(c => c.type === 'base');

    let detectedTotal = amountCandidates.length > 0 ? amountCandidates[0].val : 0;
    let validatedBase = null, validatedVatPercent = null;

    if (totalCands.length > 0 && baseCands.length > 0) {
        for (const tc of totalCands.slice(0, 3)) {
            for (const bc of baseCands.slice(0, 5)) {
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

    // --- 3. PROVEÏDOR ---
    const legalSuffixes = /\b(S\.?L\.?|S\.?L\.?U\.?|S\.?A\.?|Limitada|Anónima|Inc|Corp|GmbH|Ltd)\b/i;
    const ignoreWords = ['factura', 'invoice', 'recibo', 'receipt', 'cliente', 'customer', 'vendedor', 'bill to', 'página', 'page', 'nif', 'cif', 'fecha', 'date', 'tel', 'email', 'www'];

    let supplierCandidates = [];
    metadataItems.forEach(item => {
        const str = item.str.trim();
        if (str.length < 3 || str.length > 80) return;
        const lower = str.toLowerCase();
        if (lower.includes(userNif.toLowerCase())) return;
        if (userNameParts.some(part => lower.includes(part))) return;
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

    // --- 3.2 CATEGORIA (amb memòria prioritària) ---
    let finalCategoria = 'Otros';
    let categorySource = 'default';

    // Prioritat 1: Memòria de proveïdors (correccions manuals)
    if (providerMemory) {
        const memorized = providerMemory.findProvider(finalProveedor);
        if (memorized && memorized.matchScore >= 55 && memorized.categoria) {
            finalCategoria = memorized.categoria;
            categorySource = `memory (${memorized.matchType}, score:${memorized.matchScore})`;
            console.log(`[pdfScanner] 🧠 Memòria: "${finalProveedor}" → ${finalCategoria}`);
        }

        // Prioritat 1.5: Regles personalitzades
        if (categorySource === 'default') {
            const customCat = providerMemory.applyCustomRules(cleanText);
            if (customCat) {
                finalCategoria = customCat;
                categorySource = 'custom_rule';
                console.log(`[pdfScanner] 📏 Regla: ${finalCategoria}`);
            }
        }
    }

    // Prioritat 2: Proveïdors existents
    if (categorySource === 'default') {
        const known = matchKnownProvider(finalProveedor, existingExpenses);
        if (known && known.categoria) {
            finalCategoria = known.categoria;
            categorySource = 'existing_expenses';
        }
    }

    // Prioritat 3: Keywords
    if (categorySource === 'default') {
        finalCategoria = detectCategoryByKeywords(cleanText);
        categorySource = 'keywords';
    }

    // --- 4. IVA ---
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
        let px;
        while ((px = pctRegex.exec(cleanText)) !== null) {
            const val = parseInt(px[1]);
            if (commonVats.includes(val)) { detectedVatPercent = val; vatFoundInText = true; break; }
        }
    }

    // Base imponible
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

    // --- 5. CIF/NIF FALLBACK via memòria ---
    let finalCifNif = detectedCifNif;
    if (!finalCifNif && providerMemory) {
        const mem = providerMemory.findProvider(finalProveedor);
        if (mem && mem.cifNif) finalCifNif = mem.cifNif;
    }
    if (!finalCifNif) {
        const known = matchKnownProvider(finalProveedor, existingExpenses);
        if (known && known.cifProveedor) finalCifNif = known.cifProveedor;
    }

    // --- 6. IVA FALLBACK via memòria ---
    if (!vatFoundInText && providerMemory) {
        const mem = providerMemory.findProvider(finalProveedor);
        if (mem && mem.ivaPorcentaje !== null && mem.ivaPorcentaje !== undefined) {
            detectedVatPercent = mem.ivaPorcentaje;
            finalBaseImponible = detectedTotal / (1 + detectedVatPercent / 100);
            console.log(`[pdfScanner] 🧠 IVA memòria: ${detectedVatPercent}%`);
        }
    }

    return {
        fecha: finalFecha,
        proveedor: finalProveedor || 'Proveedor Desconocido',
        cifProveedor: finalCifNif || '',
        concepto: 'Gasto importado',
        categoria: finalCategoria,
        categorySource,
        baseImponible: finalBaseImponible,
        ivaPorcentaje: detectedVatPercent,
        total: detectedTotal
    };
};
