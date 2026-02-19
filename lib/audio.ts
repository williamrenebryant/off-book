import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';

const FREE_AUDIO_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB
const AUDIO_DIR = FileSystem.documentDirectory + 'offbook_audio/';

/**
 * Generates a unique ID using timestamp + random number.
 */
function generateUniqueId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

let activeSound: Audio.Sound | null = null;

/**
 * Ensures the audio directory exists, creating it if necessary.
 */
export async function ensureAudioDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_DIR, { intermediates: true });
  }
}

/**
 * Starts recording audio and returns the Recording object.
 * Caller must call stopRecording() to finish and save the file.
 */
export async function startRecording(): Promise<Audio.Recording> {
  await ensureAudioDir();

  // Request permissions
  const perms = await Audio.requestPermissionsAsync();
  if (!perms.granted) {
    throw new Error('Microphone permission not granted');
  }

  // Set audio mode for recording
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync({
    ...Audio.RecordingOptionsPresets.LOW_QUALITY,
    // Override to ensure AAC/M4A format
    android: {
      extension: '.m4a',
      outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
      audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
      sampleRate: 11025,
      numberOfChannels: 1,
      bitRate: 12000,
    },
    ios: {
      extension: '.m4a',
      outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_LINEARPCM,
      audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_LOW,
      sampleRate: 11025,
      numberOfChannels: 1,
      bitRate: 12000,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: true,
      linearPCMIsFloat: false,
    },
  });

  await recording.startAsync();
  return recording;
}

interface RecordingResult {
  uri: string;
  durationMs: number;
  bytes: number;
}

/**
 * Stops the recording, saves it to the audio directory, and returns metadata.
 */
export async function stopRecording(recording: Audio.Recording): Promise<RecordingResult> {
  await recording.stopAsync();
  const uri = recording.getURI();

  if (!uri) {
    throw new Error('Recording failed to produce a URI');
  }

  // Get file info
  const fileInfo = await FileSystem.getInfoAsync(uri);
  if (!fileInfo.exists) {
    throw new Error('Recording file does not exist');
  }

  // Generate unique filename and move to audio directory
  const filename = `${generateUniqueId()}.m4a`;
  const destUri = AUDIO_DIR + filename;

  await FileSystem.moveAsync({
    from: uri,
    to: destUri,
  });

  // Get duration and file size
  const recordingStatus = await recording.getStatusAsync();
  const durationMs = recordingStatus.durationMillis ?? 0;
  const finalInfo = await FileSystem.getInfoAsync(destUri);
  const bytes = finalInfo.size ?? 0;

  return {
    uri: destUri,
    durationMs,
    bytes,
  };
}

/**
 * Plays audio from the given URI. Auto-releases the sound after playback.
 */
export async function playAudio(uri: string): Promise<void> {
  // Stop any existing sound
  if (activeSound) {
    try {
      await activeSound.stopAsync();
      await activeSound.unloadAsync();
    } catch {
      // Ignore errors from unloading previous sound
    }
    activeSound = null;
  }

  // Set audio mode for playback
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
  });

  // Load and play new sound
  const { sound } = await Audio.Sound.createAsync({ uri });
  activeSound = sound;

  // Auto-release after playback
  sound.setOnPlaybackStatusUpdate(async (status) => {
    if (status.isLoaded && status.didJustFinish) {
      await sound.unloadAsync();
      activeSound = null;
    }
  });

  await sound.playAsync();
}

/**
 * Stops any currently playing audio.
 */
export async function stopAudio(): Promise<void> {
  if (activeSound) {
    try {
      await activeSound.stopAsync();
      await activeSound.unloadAsync();
    } catch {
      // Ignore errors
    }
    activeSound = null;
  }
}

interface StorageStatus {
  used: number;
  limit: number;
  overLimit: boolean;
}

/**
 * Calculates total audio storage used and returns status.
 */
export async function checkStorageLimit(): Promise<StorageStatus> {
  try {
    await ensureAudioDir();
    const files = await FileSystem.readDirectoryAsync(AUDIO_DIR);

    let totalBytes = 0;
    for (const file of files) {
      const fileUri = AUDIO_DIR + file;
      try {
        const info = await FileSystem.getInfoAsync(fileUri);
        if (info.size) {
          totalBytes += info.size;
        }
      } catch {
        // Skip files that error
      }
    }

    return {
      used: totalBytes,
      limit: FREE_AUDIO_LIMIT_BYTES,
      overLimit: totalBytes > FREE_AUDIO_LIMIT_BYTES,
    };
  } catch {
    return {
      used: 0,
      limit: FREE_AUDIO_LIMIT_BYTES,
      overLimit: false,
    };
  }
}

/**
 * Returns total audio storage used in bytes.
 */
export async function getAudioStorageUsed(): Promise<number> {
  const status = await checkStorageLimit();
  return status.used;
}

/**
 * Deletes a single audio file.
 */
export async function deleteAudioFile(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri);
  } catch (err) {
    // Silently fail if file doesn't exist
    console.warn('Failed to delete audio file:', uri, err);
  }
}

/**
 * Deletes all audio files and recreates the directory.
 */
export async function deleteAllAudio(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(AUDIO_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(AUDIO_DIR);
    }
    await ensureAudioDir();
  } catch (err) {
    console.warn('Failed to delete all audio:', err);
  }
}

/**
 * Returns the URI of the audio directory (for direct file access if needed).
 */
export function getAudioDirUri(): string {
  return AUDIO_DIR;
}
