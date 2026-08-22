import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  collection,
  setDoc, 
  getDoc, 
  getDocs,
  deleteDoc,
  onSnapshot, 
  Unsubscribe 
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { Contact, CallReminder, ContactNote, ContactAttachment, Appointment, InsuranceFolderFile } from '../types';

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore with configured databaseId if available
export const db = firebaseConfig.firestoreDatabaseId 
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export interface AgendaCloudPayload {
  contacts?: Contact[];
  appointments?: Appointment[];
  reminders?: CallReminder[];
  notes?: ContactNote[];
  attachments?: ContactAttachment[];
  insuranceFiles?: InsuranceFolderFile[];
  lastUpdated?: string;
  sourceDevice?: string;
}

// Generate unique device ID for this browser session to prevent echo loops
const SESSION_DEVICE_ID = `device_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;

const SHARED_DOC_REF = doc(db, 'agenda_data', 'shared_main');
const INSURANCE_FILES_COLLECTION = collection(db, 'agenda_insurance_files');
const ATTACHMENTS_COLLECTION = collection(db, 'agenda_attachments');

// Strip very large binary attachments from the main aggregate document
// (they are now synced via dedicated collections to prevent hitting the 1MB document limit)
function sanitizeForFirestore(payload: AgendaCloudPayload): Record<string, any> {
  const cleanPayload: Record<string, any> = {
    lastUpdated: new Date().toISOString(),
    sourceDevice: SESSION_DEVICE_ID,
  };

  if (payload.contacts !== undefined) {
    cleanPayload.contacts = payload.contacts;
  }

  if (payload.appointments !== undefined) {
    cleanPayload.appointments = payload.appointments;
  }

  if (payload.reminders !== undefined) {
    cleanPayload.reminders = payload.reminders;
  }

  if (payload.notes !== undefined) {
    cleanPayload.notes = payload.notes;
  }

  if (payload.attachments !== undefined) {
    // Keep attachment metadata without heavy dataUrls
    cleanPayload.attachments = payload.attachments.map((att) => ({
      id: att.id,
      contactId: att.contactId,
      name: att.name,
      size: att.size,
      type: att.type,
      createdAt: att.createdAt,
    }));
  }

  // Deep clone to strip all undefined values (Firestore rejects undefined)
  return JSON.parse(JSON.stringify(cleanPayload));
}

/**
 * Chunk size for large files (600KB per chunk to safely fit in Firestore 1MB doc limit)
 */
const CHUNK_SIZE = 600 * 1024;

/**
 * Save an Insurance File (PDF, image, etc.) directly into Firestore
 */
export async function saveInsuranceFileToCloud(file: InsuranceFolderFile): Promise<void> {
  if (checkIsQuotaExhausted()) return;
  try {
    const dataUrl = file.dataUrl || '';
    const fileDocRef = doc(db, 'agenda_insurance_files', file.id);

    if (dataUrl.length <= CHUNK_SIZE) {
      const payload = {
        id: file.id,
        insuranceName: file.insuranceName || 'General',
        title: file.title || file.fileName || 'Archivo',
        fileName: file.fileName || 'documento',
        fileSize: file.fileSize || 0,
        fileType: file.fileType || 'application/octet-stream',
        dataUrl: dataUrl,
        notes: file.notes || '',
        createdAt: file.createdAt || new Date().toISOString(),
        isChunked: false,
        chunkCount: 1,
        sourceDevice: SESSION_DEVICE_ID,
        updatedAt: new Date().toISOString(),
      };
      await setDoc(fileDocRef, JSON.parse(JSON.stringify(payload)));
    } else {
      // Split into chunks if large
      const totalChunks = Math.ceil(dataUrl.length / CHUNK_SIZE);
      const mainPayload = {
        id: file.id,
        insuranceName: file.insuranceName || 'General',
        title: file.title || file.fileName || 'Archivo',
        fileName: file.fileName || 'documento',
        fileSize: file.fileSize || 0,
        fileType: file.fileType || 'application/octet-stream',
        notes: file.notes || '',
        createdAt: file.createdAt || new Date().toISOString(),
        isChunked: true,
        chunkCount: totalChunks,
        sourceDevice: SESSION_DEVICE_ID,
        updatedAt: new Date().toISOString(),
      };
      await setDoc(fileDocRef, JSON.parse(JSON.stringify(mainPayload)));

      // Save each chunk
      for (let i = 0; i < totalChunks; i++) {
        const chunkContent = dataUrl.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkDocRef = doc(db, 'agenda_insurance_files', `${file.id}_chk_${i}`);
        await setDoc(chunkDocRef, {
          fileId: file.id,
          chunkIndex: i,
          chunkContent,
        });
      }
    }
  } catch (error) {
    handleQuotaError(error);
  }
}

/**
 * Delete an Insurance File from Firestore
 */
export async function deleteInsuranceFileFromCloud(fileId: string): Promise<void> {
  if (checkIsQuotaExhausted()) return;
  try {
    const fileDocRef = doc(db, 'agenda_insurance_files', fileId);
    const snap = await getDoc(fileDocRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.isChunked && data.chunkCount > 1) {
        for (let i = 0; i < data.chunkCount; i++) {
          const chunkDocRef = doc(db, 'agenda_insurance_files', `${fileId}_chk_${i}`);
          await deleteDoc(chunkDocRef).catch(() => {});
        }
      }
      await deleteDoc(fileDocRef);
    }
  } catch (error) {
    handleQuotaError(error);
  }
}

/**
 * Subscribe to real-time Insurance Files changes across all devices
 */
export function subscribeToFirestoreInsuranceFiles(
  onFiles: (files: InsuranceFolderFile[]) => void
): Unsubscribe {
  if (checkIsQuotaExhausted()) {
    return () => {};
  }

  try {
    return onSnapshot(
      INSURANCE_FILES_COLLECTION,
      async (snapshot) => {
        try {
          const mainDocs: Record<string, any>[] = [];
          const chunkMap: Record<string, Record<number, string>> = {};

          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (docSnap.id.includes('_chk_')) {
              // It's a chunk doc
              const fileId = data.fileId;
              const chunkIdx = data.chunkIndex;
              if (!chunkMap[fileId]) chunkMap[fileId] = {};
              chunkMap[fileId][chunkIdx] = data.chunkContent || '';
            } else if (data.id) {
              mainDocs.push(data);
            }
          });

          // Reconstruct full files with dataUrl
          const fullFiles: InsuranceFolderFile[] = mainDocs.map((docData) => {
            let dataUrl = docData.dataUrl || '';
            if (docData.isChunked && chunkMap[docData.id]) {
              const chunks = chunkMap[docData.id];
              const sortedParts: string[] = [];
              for (let i = 0; i < (docData.chunkCount || 1); i++) {
                sortedParts.push(chunks[i] || '');
              }
              dataUrl = sortedParts.join('');
            }

            return {
              id: docData.id,
              insuranceName: docData.insuranceName || 'General',
              title: docData.title || docData.fileName || 'Archivo',
              fileName: docData.fileName || 'documento',
              fileSize: docData.fileSize || 0,
              fileType: docData.fileType || 'application/octet-stream',
              dataUrl: dataUrl,
              notes: docData.notes || '',
              createdAt: docData.createdAt || new Date().toISOString(),
            };
          });

          // Sort latest first and exclude any legacy dummy files
          const validFiles = fullFiles.filter(
            (f) => f && f.id && !f.id.startsWith('ins-file-')
          );
          validFiles.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );

          console.log(`[Firestore] 📂 ${validFiles.length} archivos de Obras Sociales sincronizados en vivo`);
          onFiles(validFiles);
        } catch (err) {
          console.warn('[Firestore] Error procesando snapshot de archivos:', err);
        }
      },
      (error) => {
        handleQuotaError(error);
      }
    );
  } catch (err) {
    handleQuotaError(err);
    return () => {};
  }
}

/**
 * Save a Patient Contact Attachment to Firestore
 */
export async function saveAttachmentToCloud(attachment: ContactAttachment): Promise<void> {
  if (checkIsQuotaExhausted()) return;
  try {
    const docRef = doc(db, 'agenda_attachments', attachment.id);
    const dataUrl = attachment.dataUrl || '';
    const payload = {
      id: attachment.id,
      contactId: attachment.contactId,
      name: attachment.name,
      size: attachment.size,
      type: attachment.type,
      dataUrl: dataUrl.length <= CHUNK_SIZE ? dataUrl : '',
      createdAt: attachment.createdAt,
      sourceDevice: SESSION_DEVICE_ID,
    };
    await setDoc(docRef, JSON.parse(JSON.stringify(payload)));
  } catch (error) {
    handleQuotaError(error);
  }
}

/**
 * Delete a Patient Contact Attachment from Firestore
 */
export async function deleteAttachmentFromCloud(attachmentId: string): Promise<void> {
  if (checkIsQuotaExhausted()) return;
  try {
    const docRef = doc(db, 'agenda_attachments', attachmentId);
    await deleteDoc(docRef);
  } catch (error) {
    handleQuotaError(error);
  }
}

// Circuit breaker for Firestore quota
const QUOTA_STORAGE_KEY = 'firestore_quota_exhausted_until_v1';
const QUOTA_COOLDOWN_MS = 15 * 60 * 1000; // 15 minute cooldown before re-testing Firestore

function checkIsQuotaExhausted(): boolean {
  try {
    const storedUntil = localStorage.getItem(QUOTA_STORAGE_KEY);
    if (storedUntil) {
      const untilTime = parseInt(storedUntil, 10);
      if (Date.now() < untilTime) {
        return true;
      }
      localStorage.removeItem(QUOTA_STORAGE_KEY);
    }
  } catch {}
  return false;
}

function handleQuotaError(err: any) {
  const errMsg = err?.message || String(err);
  if (
    err?.code === 'resource-exhausted' || 
    errMsg.includes('resource-exhausted') || 
    errMsg.includes('Quota limit exceeded') ||
    errMsg.includes('Free daily write units')
  ) {
    try {
      const cooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
      localStorage.setItem(QUOTA_STORAGE_KEY, cooldownUntil.toString());
    } catch {}
    console.info('[Sync] ℹ️ Conmutando a sincronización vía servidor (sin límites de cuota).');
  }
}

// Track last sent payload hash to avoid duplicate writes
let lastSentHash = '';

function getPayloadHash(payload: Record<string, any>): string {
  const keys = ['contacts', 'appointments', 'reminders', 'notes', 'attachments'];
  const summary: Record<string, number> = {};
  for (const k of keys) {
    if (Array.isArray(payload[k])) {
      summary[k] = payload[k].length;
    }
  }
  return JSON.stringify(summary);
}

// Server API fallback functions
async function syncToServerApi(payload: AgendaCloudPayload): Promise<void> {
  try {
    await fetch('/api/sync/agenda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        sourceDevice: SESSION_DEVICE_ID,
        lastUpdated: new Date().toISOString(),
      }),
    });
  } catch {
    // Ignore server sync network errors
  }
}

async function fetchFromServerApi(): Promise<AgendaCloudPayload | null> {
  try {
    const res = await fetch('/api/sync/agenda');
    if (res.ok) {
      const data = await res.json();
      if (data && data.data && Object.keys(data.data).length > 0) {
        return data.data as AgendaCloudPayload;
      }
    }
  } catch {
    // Ignore server fetch network errors
  }
  return null;
}

/**
 * Push agenda updates to Firebase Firestore and Server Sync
 */
let debounceTimer: any = null;
let pendingPayload: AgendaCloudPayload = {};

export async function syncToFirestore(payload: AgendaCloudPayload, immediate = false): Promise<void> {
  pendingPayload = { ...pendingPayload, ...payload };

  // Always sync to server API for instant multi-device sync without quota constraints
  syncToServerApi(payload).catch(() => {});

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  const executeWrite = async () => {
    if (checkIsQuotaExhausted()) {
      return;
    }

    try {
      const dataToSave = sanitizeForFirestore(pendingPayload);
      const currentHash = getPayloadHash(dataToSave);
      if (currentHash === lastSentHash && !immediate) {
        // Skip duplicate write
        return;
      }

      pendingPayload = {};
      lastSentHash = currentHash;
      await setDoc(SHARED_DOC_REF, dataToSave, { merge: true });
    } catch (error: any) {
      handleQuotaError(error);
    }
  };

  if (immediate) {
    return executeWrite();
  }

  return new Promise((resolve) => {
    debounceTimer = setTimeout(async () => {
      await executeWrite();
      resolve();
    }, 200);
  });
}

/**
 * Force an immediate bidirectional sync
 */
export async function forceSyncToCloud(currentData: AgendaCloudPayload): Promise<AgendaCloudPayload | null> {
  try {
    // 1. Push local state immediately
    await syncToFirestore(currentData, true);
    
    // 2. Attempt Firestore read if not quota exhausted
    if (!checkIsQuotaExhausted()) {
      const cloud = await fetchFromFirestore();
      if (cloud) return cloud;
    }
    
    // 3. Fallback to server sync
    return await fetchFromServerApi();
  } catch (err) {
    handleQuotaError(err);
    return await fetchFromServerApi();
  }
}

/**
 * Fetch initial agenda state from Firestore or Server API
 */
export async function fetchFromFirestore(): Promise<AgendaCloudPayload | null> {
  if (checkIsQuotaExhausted()) {
    return await fetchFromServerApi();
  }

  try {
    const docSnap = await getDoc(SHARED_DOC_REF);
    if (docSnap.exists()) {
      return docSnap.data() as AgendaCloudPayload;
    }
    return await fetchFromServerApi();
  } catch (error: any) {
    handleQuotaError(error);
    return await fetchFromServerApi();
  }
}

/**
 * Subscribe to real-time changes across all devices
 */
export function subscribeToFirestoreAgenda(
  onData: (data: AgendaCloudPayload) => void
): Unsubscribe {
  // Check periodically via Server API as well
  const pollInterval = setInterval(async () => {
    try {
      const serverData = await fetchFromServerApi();
      if (serverData && serverData.sourceDevice !== SESSION_DEVICE_ID && serverData.lastUpdated) {
        onData(serverData);
      }
    } catch {}
  }, 4000);

  if (checkIsQuotaExhausted()) {
    return () => clearInterval(pollInterval);
  }

  try {
    const unsubscribeFirestore = onSnapshot(
      SHARED_DOC_REF,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as AgendaCloudPayload;
          onData(data);
        }
      },
      (error: any) => {
        handleQuotaError(error);
      }
    );

    return () => {
      clearInterval(pollInterval);
      try {
        unsubscribeFirestore();
      } catch {}
    };
  } catch (err) {
    handleQuotaError(err);
    return () => clearInterval(pollInterval);
  }
}

export { SESSION_DEVICE_ID };

