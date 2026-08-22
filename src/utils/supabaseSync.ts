import { supabase } from '../supabaseClient';
import { Contact, Appointment, CallReminder, ContactNote, ContactAttachment, InsuranceFolderFile } from '../types';

/**
 * Sync entire dataset or subset directly to Supabase
 */
export async function syncToSupabase(data: {
  contacts?: Contact[];
  appointments?: Appointment[];
  reminders?: CallReminder[];
  notes?: ContactNote[];
  attachments?: ContactAttachment[];
  insuranceFiles?: InsuranceFolderFile[];
}) {
  try {
    if (data.contacts && data.contacts.length > 0) {
      const payload = data.contacts.map((c) => ({
        id: c.id,
        full_name: c.fullName,
        is_particular: c.isParticular ?? true,
        insurance_name: c.insuranceName || null,
        affiliate_number: c.affiliateNumber || null,
        primary_phone: c.primaryPhone,
        alt_phone: c.altPhone || null,
        email: c.email || null,
        address: c.address || null,
        observations: c.observations || null,
        is_favorite: c.isFavorite ?? false,
        avatar_color: c.avatarColor || null,
        created_at: c.createdAt || new Date().toISOString(),
        updated_at: c.updatedAt || new Date().toISOString(),
      }));
      await supabase.from('contacts').upsert(payload);
    }

    if (data.appointments && data.appointments.length > 0) {
      const payload = data.appointments.map((a) => ({
        id: a.id,
        contact_id: a.contactId,
        date: a.date,
        time: a.time,
        duration_minutes: a.durationMinutes || 30,
        motive: a.motive || '',
        dentist: a.dentist || 'Yani',
        completed: a.completed ?? false,
        created_at: a.createdAt || new Date().toISOString(),
        ingresos: a.ingresos || 0,
        descartables: a.descartables || 0,
        estampillas: a.estampillas || 0,
        materiales: a.materiales || 0,
        mecanico_dental: a.mecanicoDental || 0,
        porcentaje_honorario: a.porcentajeHonorario || 50,
      }));
      await supabase.from('appointments').upsert(payload);
    }
  } catch (err) {
    console.warn('Supabase sync notice:', err);
  }
}

/**
 * Fetch all records from Supabase
 */
export async function fetchFromSupabase(): Promise<{
  contacts?: Contact[];
  appointments?: Appointment[];
} | null> {
  try {
    const [contactsRes, appointmentsRes] = await Promise.all([
      supabase.from('contacts').select('*'),
      supabase.from('appointments').select('*'),
    ]);

    const result: { contacts?: Contact[]; appointments?: Appointment[] } = {};

    if (contactsRes.data && contactsRes.data.length > 0) {
      result.contacts = contactsRes.data.map((row: any) => ({
        id: row.id,
        fullName: row.full_name,
        isParticular: row.is_particular,
        insuranceName: row.insurance_name,
        affiliateNumber: row.affiliate_number,
        primaryPhone: row.primary_phone,
        altPhone: row.alt_phone,
        email: row.email,
        address: row.address,
        observations: row.observations,
        isFavorite: row.is_favorite,
        avatarColor: row.avatar_color,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    }

    if (appointmentsRes.data && appointmentsRes.data.length > 0) {
      result.appointments = appointmentsRes.data.map((row: any) => ({
        id: row.id,
        contactId: row.contact_id,
        date: row.date,
        time: row.time,
        durationMinutes: row.duration_minutes,
        motive: row.motive,
        dentist: row.dentist,
        completed: row.completed,
        createdAt: row.created_at,
        ingresos: Number(row.ingresos || 0),
        descartables: Number(row.descartables || 0),
        estampillas: Number(row.estampillas || 0),
        materiales: Number(row.materiales || 0),
        mecanicoDental: Number(row.mecanico_dental || 0),
        porcentajeHonorario: Number(row.porcentaje_honorario || 50),
      }));
    }

    return (result.contacts || result.appointments) ? result : null;
  } catch (err) {
    console.warn('Supabase fetch notice:', err);
    return null;
  }
}
