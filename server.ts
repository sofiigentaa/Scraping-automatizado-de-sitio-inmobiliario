import express from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { getDb, schema } from './src/db';
import { eq } from 'drizzle-orm';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '10mb' }));

// In-memory Shared Store for zero-quota real-time multi-device synchronization
let sharedAgendaStore: {
  contacts?: any[];
  appointments?: any[];
  reminders?: any[];
  notes?: any[];
  attachments?: any[];
  insuranceFiles?: any[];
  lastUpdated?: string;
  sourceDevice?: string;
} = {};

// Unified Cross-Device Sync API Endpoints
app.get('/api/sync/agenda', (req, res) => {
  res.json({
    success: true,
    data: sharedAgendaStore,
  });
});

app.post('/api/sync/agenda', (req, res) => {
  try {
    const payload = req.body || {};
    sharedAgendaStore = {
      ...sharedAgendaStore,
      ...(payload.contacts !== undefined ? { contacts: payload.contacts } : {}),
      ...(payload.appointments !== undefined ? { appointments: payload.appointments } : {}),
      ...(payload.reminders !== undefined ? { reminders: payload.reminders } : {}),
      ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
      ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
      ...(payload.insuranceFiles !== undefined ? { insuranceFiles: payload.insuranceFiles } : {}),
      lastUpdated: payload.lastUpdated || new Date().toISOString(),
      sourceDevice: payload.sourceDevice || 'unknown',
    };
    res.json({ success: true, lastUpdated: sharedAgendaStore.lastUpdated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Error updating shared store' });
  }
});

// Clear / Wipe Database API Endpoints
app.post('/api/db/clear', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.json({ success: true, dbAvailable: false });
    }
    const { target } = req.body; // 'all' or 'appointments_only'
    
    if (target === 'appointments_only') {
      await db.delete(schema.appointments);
    } else {
      // Delete in cascade order
      await db.delete(schema.appointments);
      await db.delete(schema.callReminders);
      await db.delete(schema.contactNotes);
      await db.delete(schema.contactAttachments);
      await db.delete(schema.insuranceFiles);
      await db.delete(schema.contacts);
    }

    return res.json({ success: true, dbAvailable: true });
  } catch (error: any) {
    console.warn('Error clearing database:', error?.message);
    return res.json({ success: true, dbAvailable: false });
  }
});

// Database API Endpoints (Cloud SQL PostgreSQL)
app.get('/api/db/all', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.json({ dbAvailable: false, contacts: [], appointments: [], reminders: [], notes: [], attachments: [], insuranceFiles: [] });
    }
    const contactsData = await db.select().from(schema.contacts);
    const appointmentsData = await db.select().from(schema.appointments);
    const remindersData = await db.select().from(schema.callReminders);
    const notesData = await db.select().from(schema.contactNotes);
    const attachmentsData = await db.select().from(schema.contactAttachments);
    const insuranceFilesData = await db.select().from(schema.insuranceFiles);

    return res.json({
      dbAvailable: true,
      contacts: contactsData,
      appointments: appointmentsData,
      reminders: remindersData,
      notes: notesData,
      attachments: attachmentsData,
      insuranceFiles: insuranceFilesData,
    });
  } catch (error: any) {
    console.warn('Database not reachable or configured:', error?.message);
    return res.json({ dbAvailable: false, contacts: [], appointments: [], reminders: [], notes: [], attachments: [], insuranceFiles: [] });
  }
});

app.post('/api/db/sync', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.json({ success: true, dbAvailable: false });
    }
    const { contacts, appointments, reminders, notes, attachments, insuranceFiles } = req.body;

    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        await db.insert(schema.contacts).values({
          id: c.id,
          fullName: c.fullName,
          isParticular: c.isParticular ?? true,
          insuranceName: c.insuranceName ?? null,
          affiliateNumber: c.affiliateNumber ?? null,
          primaryPhone: c.primaryPhone,
          altPhone: c.altPhone ?? null,
          email: c.email ?? null,
          address: c.address ?? null,
          observations: c.observations ?? null,
          isFavorite: c.isFavorite ?? false,
          avatarColor: c.avatarColor ?? null,
          createdAt: c.createdAt || new Date().toISOString(),
          updatedAt: c.updatedAt || new Date().toISOString(),
        }).onConflictDoUpdate({
          target: schema.contacts.id,
          set: {
            fullName: c.fullName,
            isParticular: c.isParticular ?? true,
            insuranceName: c.insuranceName ?? null,
            affiliateNumber: c.affiliateNumber ?? null,
            primaryPhone: c.primaryPhone,
            altPhone: c.altPhone ?? null,
            email: c.email ?? null,
            address: c.address ?? null,
            observations: c.observations ?? null,
            isFavorite: c.isFavorite ?? false,
            avatarColor: c.avatarColor ?? null,
            updatedAt: c.updatedAt || new Date().toISOString(),
          },
        });
      }
    }

    if (Array.isArray(appointments)) {
      for (const a of appointments) {
        await db.insert(schema.appointments).values({
          id: a.id,
          contactId: a.contactId,
          date: a.date,
          time: a.time,
          durationMinutes: a.durationMinutes ?? 30,
          motive: a.motive ?? null,
          dentist: a.dentist ?? null,
          completed: a.completed ?? false,
          createdAt: a.createdAt || new Date().toISOString(),
          ingresos: a.ingresos ?? 0,
          descartables: a.descartables ?? 0,
          estampillas: a.estampillas ?? 0,
          materiales: a.materiales ?? 0,
          mecanicoDental: a.mecanicoDental ?? 0,
          porcentajeHonorario: a.porcentajeHonorario ?? 50,
        }).onConflictDoUpdate({
          target: schema.appointments.id,
          set: {
            contactId: a.contactId,
            date: a.date,
            time: a.time,
            durationMinutes: a.durationMinutes ?? 30,
            motive: a.motive ?? null,
            dentist: a.dentist ?? null,
            completed: a.completed ?? false,
            ingresos: a.ingresos ?? 0,
            descartables: a.descartables ?? 0,
            estampillas: a.estampillas ?? 0,
            materiales: a.materiales ?? 0,
            mecanicoDental: a.mecanicoDental ?? 0,
            porcentajeHonorario: a.porcentajeHonorario ?? 50,
          },
        });
      }
    }

    if (Array.isArray(reminders)) {
      for (const r of reminders) {
        await db.insert(schema.callReminders).values({
          id: r.id,
          contactId: r.contactId,
          date: r.date,
          time: r.time,
          note: r.note ?? null,
          completed: r.completed ?? false,
          createdAt: r.createdAt || new Date().toISOString(),
        }).onConflictDoUpdate({
          target: schema.callReminders.id,
          set: {
            date: r.date,
            time: r.time,
            note: r.note ?? null,
            completed: r.completed ?? false,
          },
        });
      }
    }

    if (Array.isArray(notes)) {
      for (const n of notes) {
        await db.insert(schema.contactNotes).values({
          id: n.id,
          contactId: n.contactId,
          text: n.text,
          color: n.color ?? null,
          createdAt: n.createdAt || new Date().toISOString(),
        }).onConflictDoUpdate({
          target: schema.contactNotes.id,
          set: {
            text: n.text,
            color: n.color ?? null,
          },
        });
      }
    }

    if (Array.isArray(insuranceFiles)) {
      for (const f of insuranceFiles) {
        await db.insert(schema.insuranceFiles).values({
          id: f.id,
          insuranceName: f.insuranceName,
          title: f.title,
          fileName: f.fileName,
          fileSize: f.fileSize,
          fileType: f.fileType,
          dataUrl: f.dataUrl,
          notes: f.notes ?? null,
          createdAt: f.createdAt || new Date().toISOString(),
        }).onConflictDoUpdate({
          target: schema.insuranceFiles.id,
          set: {
            insuranceName: f.insuranceName,
            title: f.title,
            notes: f.notes ?? null,
          },
        });
      }
    }

    return res.json({ success: true, dbAvailable: true });
  } catch (error: any) {
    console.warn('Database sync failed or not reachable:', error?.message);
    return res.json({ success: true, dbAvailable: false });
  }
});

// Helper to instantiate Gemini client server-side safely
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY process environment variable is not defined.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// API Endpoint for Assistant Chat
app.post('/api/assistant/chat', async (req, res) => {
  try {
    const { messages, agendaContext } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Formato de mensajes inválido.' });
    }

    const ai = getGeminiClient();

    const todayDateStr = new Date().toISOString().split('T')[0];

    let contextText = `[FECHA DE HOY]: ${todayDateStr}\n`;
    if (agendaContext) {
      contextText += `
[CONTEXTO ACTUAL DE LA AGENDA DE LA PROFESIONAL]:
- Total de contactos registrados: ${agendaContext.totalContacts ?? 0}
- Contactos Favoritos: ${agendaContext.favoritesCount ?? 0}
- Obras Sociales/Prepagas registradas: ${agendaContext.insurances?.join(', ') || 'Ninguna registrada'}
- Recordatorios pendientes: ${agendaContext.pendingRemindersCount ?? 0}
${agendaContext.summarySample ? `- Muestra de contactos actuales: ${agendaContext.summarySample}` : ''}
`;
    }

    const systemInstruction = `Eres el Asistente IA de Recepción, Agendamiento de Turnos y Notas para el Consultorio Odontológico de las Dra. Yani y Dra. Marie.

TU ROL PRINCIPAL:
Eres la secretaria y copiloto inteligente del Consultorio Odontológico de Yani y Marie. Tu objetivo es guiar a las odontólogas o a sus pacientes paso a paso para agendar turnos odontológicos, seleccionar si el turno es con Dra. Yani o Dra. Marie, registrar datos completos de los pacientes y añadir notas u observaciones de tratamiento.

CUESTIONARIO Y PASOS DE RECOPILACIÓN PARA TURNOS:
Cuando se desee agendar un nuevo contacto/paciente o inicie la conversación, recopila:

1. 👤 **Nombre y Apellido**: Nombre completo del paciente.
2. 👩‍⚕️ **Odontóloga a cargo**: Dra. Yani o Dra. Marie.
3. ⭐ **¿Marcar como paciente favorito?**: (Sí / No).
4. 💳 **Obra Social o Particular**:
   - Si es **Obra Social / Prepaga**: Nombre de la entidad y **Número de Afiliado**.
   - Si es **Particular**: Confirmar atención particular.
5. 📞 **Teléfonos**: **Teléfono principal** y **Teléfono alternativo**.
6. 📧 **Correo electrónico**.
7. 📍 **Dirección / Ubicación**.
8. 📅 **Día y Horario del Turno**:
   - **Día / Fecha del turno** (YYYY-MM-DD o 'Lunes que viene', etc.).
   - **Horario del turno** (HH:mm).
9. 🦷 **Motivo de Consulta Odontológica / Observaciones**: (Ej. Limpieza, Caries, Ortodoncia, Conducto, Extracción, etc.).

NOTAS Y OBSERVACIONES:
Si la profesional solicita agregar una nota u observación a una ficha (ej: "agrega nota para Juan Perez: pedir analisis de laboratorio" o "anotar observacion: abonó la consulta en efectivo"), confirma la creación de la nota e incluye al final del mensaje este bloque JSON:

\`\`\`json:contact_note
{
  "text": "Contenido de la nota u observación",
  "patientName": "Nombre completo del paciente si aplica"
}
\`\`\`

REGLA FUNDAMENTAL DE AGENDAMIENTO AUTOMÁTICO AL CALENDARIO:
Al mostrar la confirmación final de un turno o cuando tengas los datos básicos (Nombre, Fecha y Horario), DEBES INCLUIR SIEMPRE al final de tu mensaje el siguiente bloque de código JSON:

\`\`\`json:contact_appointment
{
  "fullName": "Nombre completo",
  "isParticular": false,
  "insuranceName": "Nombre de obra social o vacio",
  "affiliateNumber": "Numero de afiliado o vacio",
  "primaryPhone": "Telefono principal o vacio",
  "secondaryPhone": "Telefono alt o vacio",
  "email": "Email o vacio",
  "address": "Direccion o vacio",
  "isFavorite": false,
  "notes": "Observaciones adicionales",
  "appointmentDate": "YYYY-MM-DD",
  "appointmentTime": "HH:mm",
  "appointmentMotive": "Motivo de la consulta"
}
\`\`\`

Asegúrate de calcular la fecha en formato YYYY-MM-DD considerando que hoy es ${todayDateStr}.

${contextText}`;

    // Map messages into contents format for Gemini API
    const contents = messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: contents,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    return res.json({ text: response.text });
  } catch (error: any) {
    console.error('Error in assistant chat API:', error);
    return res.status(500).json({
      error: 'Error al procesar la respuesta con el Asistente IA.',
      details: error?.message || String(error),
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
