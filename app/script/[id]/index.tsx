import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { getScript, getProgress, saveScript } from '@/lib/storage';
import { Script, ScriptProgress, Scene } from '@/types';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/ui/ProgressBar';

export default function ScriptOverviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [script, setScript] = useState<Script | null>(null);
  const [progress, setProgress] = useState<ScriptProgress | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      Promise.all([getScript(id), getProgress(id)]).then(([s, p]) => {
        setScript(s);
        setProgress(p);
      });
    }, [id])
  );

  if (!script) return null;

  const handleRename = () => {
    if (!script) return;
    Alert.prompt(
      'Rename Script',
      '',
      (newTitle) => {
        if (!newTitle?.trim() || newTitle.trim() === script.title) return;
        const updated = { ...script, title: newTitle.trim() };
        setScript(updated);
        saveScript(updated);
      },
      'plain-text',
      script.title,
    );
  };

  const handleChangeCharacter = () => {
    if (!script) return;

    const options = script.characters.map((char) => ({
      text: char,
      onPress: () => {
        if (char !== script.selectedCharacter) {
          const updated = { ...script, selectedCharacter: char };
          setScript(updated);
          saveScript(updated);
        }
      },
    }));

    Alert.alert('Choose Character', 'Which character are you practicing?', [
      ...options,
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const getSceneProgress = (scene: Scene): number => {
    if (!progress) return 0;
    const sp = progress.sceneProgress[scene.id];
    if (!sp) return 0;

    const myLines = scene.lines.filter((l) => l.character === script.selectedCharacter);
    if (myLines.length === 0) return 0;
    const mastered = myLines.filter((l) => sp.lineProgress[l.id]?.mastered).length;
    return mastered / myLines.length;
  };

  const countMyLines = (scene: Scene): number =>
    scene.lines.filter((l) => l.character === script.selectedCharacter).length;

  const renderScene = ({ item, index }: { item: Scene; index: number }) => {
    const myLines = countMyLines(item);
    const prog = getSceneProgress(item);
    if (myLines === 0) return null;

    return (
      <TouchableOpacity
        onPress={() =>
          router.push({
            pathname: `/script/${id}/practice` as '/script/[id]/practice',
            params: { id, sceneId: item.id },
          })
        }
        activeOpacity={0.75}
      >
        <Card variant="raised" style={styles.sceneCard}>
          <View style={styles.sceneHeader}>
            <View style={styles.sceneNumber}>
              <Text style={styles.sceneNumberText}>{index + 1}</Text>
            </View>
            <View style={styles.sceneInfo}>
              <Text style={styles.sceneTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.sceneMeta}>
                {myLines} {myLines === 1 ? 'line' : 'lines'} for {script.selectedCharacter}
              </Text>
            </View>
            <View style={styles.sceneRight}>
              {prog > 0 && (
                <Text style={styles.progressLabel}>{Math.round(prog * 100)}%</Text>
              )}
              <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
            </View>
          </View>
          {prog > 0 && <ProgressBar progress={prog} style={styles.progressBar} />}
        </Card>
      </TouchableOpacity>
    );
  };

  const scenesWithLines = script.scenes.filter((s) => countMyLines(s) > 0);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.scriptTitle} numberOfLines={1}>
              {script.title}
            </Text>
            <TouchableOpacity onPress={handleRename}>
              <Ionicons name="pencil-outline" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={handleChangeCharacter} style={styles.characterRow}>
            <Text style={styles.characterName}>{script.selectedCharacter}</Text>
            {script.characters.length > 1 && (
              <Ionicons name="chevron-down" size={14} color={Colors.accent} style={styles.characterChevron} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{scenesWithLines.length}</Text>
          <Text style={styles.statLabel}>scenes</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statNum}>
            {script.scenes.reduce((t, s) => t + countMyLines(s), 0)}
          </Text>
          <Text style={styles.statLabel}>lines</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statNum}>{script.characters.length}</Text>
          <Text style={styles.statLabel}>characters</Text>
        </View>
      </View>

      <Text style={styles.listHeader}>Choose a scene to practice</Text>

      <FlatList
        data={script.scenes}
        keyExtractor={(item) => item.id}
        renderItem={renderScene}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.addScenesRow}>
        <TouchableOpacity
          style={styles.addScenesBtn}
          onPress={() => router.push({
            pathname: '/record',
            params: {
              scriptId: script!.id,
              existingCharacters: script!.characters.join(','),
              isAddingScene: 'true'
            },
          })}
        >
          <Ionicons name="mic-outline" size={18} color={Colors.accent} />
          <Text style={styles.addScenesBtnText}>Record a scene</Text>
        </TouchableOpacity>
        <View style={styles.addScenesDivider} />
        <TouchableOpacity
          style={styles.addScenesBtn}
          onPress={() => router.push({
            pathname: '/upload',
            params: { appendToScriptId: script!.id },
          })}
        >
          <Ionicons name="cloud-upload-outline" size={18} color={Colors.accent} />
          <Text style={styles.addScenesBtnText}>Upload PDF</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  scriptTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  characterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  characterName: {
    fontSize: FontSize.sm,
    color: Colors.accent,
    fontWeight: '600',
  },
  characterChevron: {
    marginTop: 1,
  },
  statsRow: {
    flexDirection: 'row',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statNum: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xs,
  },
  listHeader: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  list: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  sceneCard: {
    gap: Spacing.sm,
  },
  sceneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sceneNumber: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sceneNumberText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.white,
  },
  sceneInfo: {
    flex: 1,
  },
  sceneTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  sceneMeta: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: 1,
  },
  sceneRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  progressLabel: {
    fontSize: FontSize.sm,
    color: Colors.accent,
    fontWeight: '600',
  },
  progressBar: {
    marginTop: 2,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addScenesRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  addScenesBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: Spacing.md,
    justifyContent: 'center',
  },
  addScenesDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.sm,
  },
  addScenesBtnText: {
    fontSize: FontSize.sm,
    color: Colors.accent,
    fontWeight: '600',
  },
});
