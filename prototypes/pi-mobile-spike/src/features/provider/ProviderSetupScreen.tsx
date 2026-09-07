import type { AuthPrompt, AuthType, ThinkingLevel } from '@earendil-works/pi-ai';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  connectProvider,
  getConnectedProviders,
  getProviderOptions,
  getSelectedModel,
  getSelectedProvider,
  getThinkingLevel,
  getWebSearchEnabled,
  selectProvider,
  selectProviderModel,
  selectThinkingLevel,
  setWebSearchEnabled,
  type ProviderOption,
} from '../../ai/piClient';
import { IconButton, PrimaryButton } from '../../components/controls';
import { KeyboardSafeArea } from '../../components/KeyboardSafeArea';
import { ScreenReveal } from '../../components/ScreenReveal';
import { color, radius, space, type } from '../../design/tokens';
import { locale, t } from '../../i18n';

type PendingPrompt = {
  prompt: AuthPrompt;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

const preferredProviders = ['openai-codex', 'openai', 'anthropic', 'google', 'openrouter'];

export function ProviderSetupScreen(props: {
  onBack?: () => void;
  onboarding?: boolean;
  completionLabel?: string;
  onComplete?: () => void | Promise<void>;
}) {
  const providers = useMemo(() => {
    const rank = (provider: ProviderOption) => {
      const index = preferredProviders.indexOf(provider.id);
      return index < 0 ? preferredProviders.length : index;
    };
    return getProviderOptions().sort((left, right) =>
      rank(left) - rank(right) || left.name.localeCompare(right.name),
    );
  }, []);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [expanded, setExpanded] = useState<ProviderOption>();
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>();
  const [webSearch, setWebSearch] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [thinkingPickerOpen, setThinkingPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt>();

  const refreshConnectionState = async () => {
    const [connected, selected] = await Promise.all([
      getConnectedProviders(),
      getSelectedProvider(),
    ]);
    setConnectedIds(connected);
    setSelectedProviderId(selected);
    setCatalogOpen(connected.length === 0);
    if (connected.includes(selected)) {
      const [modelId, searchEnabled] = await Promise.all([
        getSelectedModel(selected),
        getWebSearchEnabled(selected),
      ]);
      setSelectedModelId(modelId);
      setWebSearch(searchEnabled);
      setThinkingLevel(await getThinkingLevel(selected, modelId));
    }
  };

  useEffect(() => {
    void refreshConnectionState();
  }, []);

  const connectedProviders = providers.filter((provider) => connectedIds.includes(provider.id));
  const availableProviders = providers.filter((provider) =>
    !connectedIds.includes(provider.id)
    && provider.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const selectedModel = selectedProvider?.models.find((model) => model.id === (selectedModelId ?? selectedProvider.automaticModelId));
  const selectedModelSupportsSearch = selectedModel?.supportsWebSearch === true;

  const chooseConnected = async (provider: ProviderOption) => {
    await selectProvider(provider.id);
    const [modelId, searchEnabled] = await Promise.all([
      getSelectedModel(provider.id),
      getWebSearchEnabled(provider.id),
    ]);
    setSelectedProviderId(provider.id);
    setSelectedModelId(modelId);
    setWebSearch(searchEnabled);
    setThinkingLevel(await getThinkingLevel(provider.id, modelId));
  };

  const connect = async (provider: ProviderOption, authType: AuthType) => {
    if (connecting) return;
    setExpanded(provider);
    setConnecting(true);
    setError('');
    setStatus(t('connectingProvider'));
    try {
      await connectProvider(provider.id, authType, {
        onEvent: (event) => {
          if (event.type === 'auth_url') {
            setStatus(event.instructions ?? t('finishInBrowser'));
            void Linking.openURL(event.url);
          } else if (event.type === 'device_code') {
            setStatus(`${t('deviceCode')}: ${event.userCode}`);
            void Linking.openURL(event.verificationUri);
          } else {
            setStatus(event.message);
          }
        },
        onPrompt: (prompt) => new Promise<string>((resolve, reject) => {
          setPendingPrompt({ prompt, resolve, reject });
        }),
      });
      await refreshConnectionState();
      setCatalogOpen(false);
      setExpanded(undefined);
      setStatus('');
    } catch {
      setError(t('providerConnectionError'));
      setStatus('');
    } finally {
      setConnecting(false);
    }
  };

  const chooseModel = async (modelId?: string) => {
    if (!selectedProvider) return;
    await selectProviderModel(selectedProvider.id, modelId);
    setSelectedModelId(modelId);
    setThinkingLevel(await getThinkingLevel(selectedProvider.id, modelId));
    setModelPickerOpen(false);
  };

  const chooseThinking = async (level?: ThinkingLevel) => {
    if (!selectedProvider) return;
    await selectThinkingLevel(selectedProvider.id, selectedModelId, level);
    setThinkingLevel(level);
    setThinkingPickerOpen(false);
  };

  const toggleSearch = async (enabled: boolean) => {
    if (!selectedProvider) return;
    setWebSearch(enabled);
    await setWebSearchEnabled(selectedProvider.id, enabled);
  };

  const closePrompt = () => {
    pendingPrompt?.reject(new Error('Provider setup cancelled'));
    setPendingPrompt(undefined);
  };

  return (
    <KeyboardSafeArea>
      <ScreenReveal>
        {props.onboarding && <View style={styles.progress}>{[0, 1, 2, 3, 4].map((index) => <View key={index} style={[styles.progressBar, styles.progressBarActive]} />)}</View>}
        <View style={styles.header}>
          {props.onBack ? <IconButton icon="arrow-back" label={t('back')} onPress={props.onBack} /> : <View style={styles.headerSpacer} />}
          <Text selectable adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={styles.headerTitle}>{t(props.onboarding ? 'setupProviderTitle' : 'aiProvider')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.scroll}>
          {props.onboarding && <Text selectable style={styles.stepLabel}>{t('setupStep', { current: 5, total: 5 })}</Text>}
          <Text selectable style={styles.intro}>{t(props.onboarding ? 'setupProviderBody' : 'providerHelp')}</Text>

          {connectedProviders.length > 0 && (
            <>
              <Text selectable style={styles.sectionLabel}>{t('connectedProviders')}</Text>
              <View style={styles.providerList}>
                {connectedProviders.map((provider) => (
                  <ProviderRow
                    key={provider.id}
                    provider={provider}
                    selected={selectedProviderId === provider.id}
                    onPress={() => void chooseConnected(provider)}
                  />
                ))}
              </View>

              {selectedProvider && <Pressable accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(!advanced)} style={styles.advancedButton}><View style={{ flex: 1 }}><Text style={styles.configurationLabel}>{locale === 'ru' ? 'Параметры анализа' : 'Analysis settings'}</Text><Text style={styles.configurationValue}>{selectedModel?.name ?? t('automatic')}</Text></View><Ionicons name={advanced ? 'chevron-up' : 'chevron-down'} size={20} color={color.action} /></Pressable>}
              {selectedProvider && advanced && (
                <View style={styles.configuration}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setModelPickerOpen(true)}
                    style={({ pressed }) => [styles.configurationRow, pressed && styles.pressed]}
                  >
                    <View style={styles.configurationCopy}>
                      <Text style={styles.configurationLabel}>{t('model')}</Text>
                      <Text numberOfLines={1} style={styles.configurationValue}>
                        {selectedProvider.models.find((model) => model.id === selectedModelId)?.name ?? t('automatic')}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={color.muted} />
                  </Pressable>
                  {selectedModel && selectedModel.thinkingLevels.length > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setThinkingPickerOpen(true)}
                      style={({ pressed }) => [styles.configurationRow, pressed && styles.pressed]}
                    >
                      <View style={styles.configurationCopy}>
                        <Text style={styles.configurationLabel}>{t('thinkingLevel')}</Text>
                        <Text style={styles.configurationValue}>{thinkingLabel(thinkingLevel)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={color.muted} />
                    </Pressable>
                  )}
                  {selectedModelSupportsSearch && (
                    <View style={styles.configurationRow}>
                      <View style={styles.configurationCopy}>
                        <Text selectable style={styles.configurationLabel}>{t('webSearch')}</Text>
                        <Text selectable style={styles.configurationValue}>{t('webSearchHelp')}</Text>
                      </View>
                      <Switch
                        accessibilityLabel={t('webSearch')}
                        onValueChange={(enabled) => void toggleSearch(enabled)}
                        thumbColor={color.surface}
                        trackColor={{ false: color.line, true: color.action }}
                        value={webSearch}
                      />
                    </View>
                  )}
                </View>
              )}
            </>
          )}

          <Pressable accessibilityRole="button" onPress={() => setCatalogOpen((open) => !open)} style={({ pressed }) => [styles.addProvider, pressed && styles.pressed]}>
            <Text style={styles.addProviderText}>{t(catalogOpen ? 'hideProviders' : 'addProvider')}</Text>
          </Pressable>

          {catalogOpen && (
            <View style={styles.catalog}>
              <Text selectable style={styles.catalogTitle}>{t('addProvider')}</Text>
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={18} color={color.muted} />
                <TextInput onChangeText={setQuery} placeholder={t('searchProviders')} placeholderTextColor={color.muted} style={styles.search} value={query} />
              </View>
              <View style={styles.providerList}>
                {availableProviders.map((provider) => {
                  const active = expanded?.id === provider.id;
                  return (
                    <View key={provider.id} style={styles.catalogProvider}>
                      <Pressable accessibilityRole="button" onPress={() => setExpanded(active ? undefined : provider)} style={({ pressed }) => [styles.catalogRow, pressed && styles.pressed]}>
                        <View style={styles.emptyRadio} />
                        <Text style={styles.providerName}>{provider.name}</Text>
                        <Text style={styles.connectLabel}>{t('connect')}</Text>
                      </Pressable>
                      {active && (
                        <View style={styles.authActions}>
                          {provider.authTypes.map((authType) => (
                            <Pressable key={authType} accessibilityRole="button" disabled={connecting} onPress={() => void connect(provider, authType)} style={({ pressed }) => [styles.authButton, pressed && styles.pressed]}>
                              <Ionicons name={authType === 'oauth' ? 'open-outline' : 'key-outline'} size={18} color={color.surface} />
                              <Text style={styles.authButtonText}>{t(authType === 'oauth' ? 'providerSignIn' : 'enterApiKey')}</Text>
                            </Pressable>
                          ))}
                          {connecting && <ActivityIndicator color={color.action} />}
                          {status ? <Text selectable style={styles.status}>{status}</Text> : null}
                          {error ? <Text selectable accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          )}
          {props.onComplete && connectedProviders.length > 0 && selectedProviderId ? (
            <View style={styles.completeAction}><PrimaryButton label={props.completionLabel ?? t('continue')} onPress={() => void props.onComplete?.()} /></View>
          ) : null}
        </ScrollView>
      </ScreenReveal>

      <ModelPicker provider={selectedProvider} selectedModelId={selectedModelId} visible={modelPickerOpen} onClose={() => setModelPickerOpen(false)} onSelect={chooseModel} />
      <ThinkingPicker levels={selectedModel?.thinkingLevels ?? []} selected={thinkingLevel} visible={thinkingPickerOpen} onClose={() => setThinkingPickerOpen(false)} onSelect={chooseThinking} />
      <ProviderPromptModal pending={pendingPrompt} onCancel={closePrompt} onComplete={() => setPendingPrompt(undefined)} />
    </KeyboardSafeArea>
  );
}

function thinkingLabel(level?: ThinkingLevel): string {
  if (!level) return t('thinkingAutomatic');
  return t(`${level}Thinking` as 'minimalThinking');
}

function ThinkingPicker(props: { levels: ThinkingLevel[]; selected?: ThinkingLevel; visible: boolean; onClose: () => void; onSelect: (level?: ThinkingLevel) => void | Promise<void> }) {
  return (
    <Modal animationType="fade" onRequestClose={props.onClose} transparent visible={props.visible}>
      <SafeAreaView style={styles.modalBackdrop}>
        <View style={styles.modelPicker}>
          <View style={styles.modelPickerHeader}><Text selectable style={styles.promptTitle}>{t('chooseThinkingLevel')}</Text><IconButton icon="close" label={t('close')} onPress={props.onClose} /></View>
          <ScrollView contentContainerStyle={styles.modelList} keyboardShouldPersistTaps="handled">
            <ModelRow label={t('thinkingAutomatic')} selected={!props.selected} onPress={() => void props.onSelect()} />
            {props.levels.map((level) => <ModelRow key={level} label={thinkingLabel(level)} selected={props.selected === level} onPress={() => void props.onSelect(level)} />)}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ProviderRow(props: { provider: ProviderOption; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: props.selected }} onPress={props.onPress} style={({ pressed }) => [styles.providerRow, props.selected && styles.providerSelected, pressed && styles.pressed]}>
      <View style={[styles.providerRadio, props.selected && styles.providerRadioSelected]}>{props.selected && <Ionicons name="checkmark" size={15} color={color.surface} />}</View>
      <Text style={styles.providerName}>{props.provider.name}</Text>
    </Pressable>
  );
}

function ModelPicker(props: { provider?: ProviderOption; selectedModelId?: string; visible: boolean; onClose: () => void; onSelect: (modelId?: string) => void | Promise<void> }) {
  const [search, setSearch] = useState('');
  useEffect(() => setSearch(''), [props.provider?.id, props.visible]);
  const matchingModels = props.provider?.models.filter((model) => `${model.name} ${model.id}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [];
  return (
    <Modal animationType="fade" onRequestClose={props.onClose} transparent visible={props.visible}>
      <SafeAreaView style={styles.modalBackdrop}>
        <View style={styles.modelPicker}>
          <View style={styles.modelPickerHeader}><Text selectable style={styles.promptTitle}>{t('chooseModel')}</Text><IconButton icon="close" label={t('close')} onPress={props.onClose} /></View>
          <ScrollView contentContainerStyle={styles.modelList} keyboardShouldPersistTaps="handled">
            <TextInput accessibilityLabel={locale === 'ru' ? 'Поиск модели' : 'Search models'} value={search} onChangeText={setSearch} placeholder={locale === 'ru' ? 'Найти модель…' : 'Find a model…'} placeholderTextColor={color.muted} style={styles.modelSearch} />
            <ModelRow label={t('automatic')} selected={!props.selectedModelId} onPress={() => void props.onSelect()} />
            {matchingModels.length === 0 && <Text selectable style={styles.modelOptionDetail}>{locale === 'ru' ? 'Подходящих моделей нет' : 'No matching models'}</Text>}
            {matchingModels.map((model) => <ModelRow key={model.id} detail={model.id} label={model.name} selected={props.selectedModelId === model.id} onPress={() => void props.onSelect(model.id)} />)}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ModelRow(props: { label: string; detail?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: props.selected }} onPress={props.onPress} style={({ pressed }) => [styles.modelOption, pressed && styles.pressed]}>
      <View style={[styles.providerRadio, props.selected && styles.providerRadioSelected]}>{props.selected && <Ionicons name="checkmark" size={15} color={color.surface} />}</View>
      <View style={styles.configurationCopy}><Text style={styles.modelOptionTitle}>{props.label}</Text>{props.detail ? <Text numberOfLines={1} style={styles.modelOptionDetail}>{props.detail}</Text> : null}</View>
    </Pressable>
  );
}

function ProviderPromptModal(props: { pending?: PendingPrompt; onCancel: () => void; onComplete: () => void }) {
  const [value, setValue] = useState('');
  const pending = props.pending;
  const submit = (nextValue = value) => {
    if (!pending || !nextValue.trim()) return;
    pending.resolve(nextValue.trim());
    setValue('');
    props.onComplete();
  };
  return (
    <Modal animationType="fade" onRequestClose={props.onCancel} transparent visible={Boolean(pending)}>
      <SafeAreaView style={styles.modalBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' || Platform.OS === 'android' ? 'padding' : undefined} style={styles.promptKeyboard}>
          <View style={styles.prompt}>
          <Text selectable style={styles.promptTitle}>{pending?.prompt.message}</Text>
          {pending?.prompt.type === 'select' ? (
            <View style={styles.promptOptions}>{pending.prompt.options.map((option) => <Pressable key={option.id} onPress={() => submit(option.id)} style={styles.promptOption}><Text style={styles.promptOptionTitle}>{option.label}</Text>{option.description ? <Text style={styles.promptOptionBody}>{option.description}</Text> : null}</Pressable>)}</View>
          ) : (
            <><TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setValue} onSubmitEditing={() => submit()} placeholder={pending?.prompt.placeholder} placeholderTextColor={color.muted} secureTextEntry={pending?.prompt.type === 'secret'} style={styles.promptInput} value={value} /><Pressable disabled={!value.trim()} onPress={() => submit()} style={[styles.promptSubmit, !value.trim() && styles.disabled]}><Text style={styles.promptSubmitText}>{t('continue')}</Text></Pressable></>
          )}
          <Pressable onPress={props.onCancel} hitSlop={10}><Text style={styles.promptCancel}>{t('cancel')}</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: color.canvas, flex: 1 },
  scroll: { flex: 1 },
  promptKeyboard: { alignItems: 'center', alignSelf: 'stretch', flex: 1, justifyContent: 'center' },
  modelSearch: { backgroundColor: color.canvas, color: color.ink, minHeight: 48, borderRadius: 12, paddingHorizontal: 14, fontSize: 15, marginBottom: 10 },
  advancedButton: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 72, paddingHorizontal: 16, marginTop: 14, backgroundColor: color.actionSoft, borderRadius: 16 },
  progress: { flexDirection: 'row', gap: 6, paddingHorizontal: space.lg, paddingTop: space.md },
  progressBar: { backgroundColor: color.line, borderRadius: 2, flex: 1, height: 3 },
  progressBarActive: { backgroundColor: color.action },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.md, paddingTop: space.sm },
  headerSpacer: { width: 48 },
  headerTitle: { color: color.ink, flex: 1, fontFamily: type.ticketBold, fontSize: 20, textAlign: 'center' },
  content: { padding: space.md, paddingBottom: space.xxl },
  intro: { color: color.muted, fontSize: 15, lineHeight: 22, maxWidth: 340 },
  stepLabel: { color: color.muted, fontFamily: type.ticketBold, fontSize: 13, letterSpacing: 0.7, marginBottom: space.sm, textTransform: 'uppercase' },
  completeAction: { marginTop: space.lg },
  sectionLabel: { color: color.muted, fontFamily: type.ticketBold, fontSize: 13, letterSpacing: 0.8, marginLeft: 3, marginTop: space.lg, textTransform: 'uppercase' },
  providerList: { gap: space.sm, marginTop: space.sm },
  providerRow: { alignItems: 'center', backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 64, paddingHorizontal: 13 },
  providerSelected: { borderColor: color.action },
  providerRadio: { alignItems: 'center', borderColor: color.line, borderRadius: radius.round, borderWidth: 1, height: 24, justifyContent: 'center', width: 24 },
  providerRadioSelected: { backgroundColor: color.action, borderColor: color.action },
  providerName: { color: color.ink, flex: 1, fontFamily: type.ticketBold, fontSize: 17 },
  selectedLabel: { color: color.muted, fontSize: 12 },
  configuration: { backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, marginTop: space.sm, overflow: 'hidden' },
  configurationRow: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 62, paddingHorizontal: 13, paddingVertical: space.sm },
  configurationCopy: { flex: 1, minWidth: 0 },
  configurationLabel: { color: color.ink, fontFamily: type.ticketBold, fontSize: 15 },
  configurationValue: { color: color.muted, fontSize: 12, marginTop: 3 },
  addProvider: { alignItems: 'center', borderColor: color.line, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', marginTop: space.lg, minHeight: 50 },
  addProviderText: { color: color.action, fontFamily: type.ticketBold, fontSize: 16 },
  catalog: { borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.lg, paddingTop: space.lg },
  catalogTitle: { color: color.ink, fontFamily: type.ticketBold, fontSize: 16 },
  searchWrap: { alignItems: 'center', backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', marginTop: space.sm, paddingHorizontal: 13 },
  search: { color: color.ink, flex: 1, fontSize: 15, height: 48, paddingHorizontal: 9 },
  catalogProvider: { backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  catalogRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 64, paddingHorizontal: 13 },
  emptyRadio: { borderColor: color.line, borderRadius: radius.round, borderWidth: 1, height: 24, width: 24 },
  connectLabel: { color: color.action, fontFamily: type.ticketBold, fontSize: 14 },
  authActions: { borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth, gap: space.sm, padding: 12 },
  authButton: { alignItems: 'center', backgroundColor: color.action, borderRadius: radius.control, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14 },
  authButtonText: { color: color.surface, fontFamily: type.ticketBold, fontSize: 16 },
  status: { color: color.muted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  error: { color: color.error, fontSize: 13, textAlign: 'center' },
  pressed: { opacity: 0.72 },
  modalBackdrop: { alignItems: 'center', backgroundColor: 'rgba(30, 33, 38, 0.72)', flex: 1, justifyContent: 'center', padding: space.lg },
  modelPicker: { backgroundColor: color.surface, borderRadius: radius.surface, maxHeight: '82%', maxWidth: 420, overflow: 'hidden', width: '100%' },
  modelPickerHeader: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingLeft: space.md, paddingRight: space.sm, paddingVertical: space.sm },
  modelList: { padding: space.sm },
  modelOption: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 58, paddingHorizontal: space.sm, paddingVertical: space.sm },
  modelOptionTitle: { color: color.ink, fontFamily: type.ticketBold, fontSize: 16 },
  modelOptionDetail: { color: color.muted, fontSize: 11, marginTop: 2 },
  prompt: { backgroundColor: color.surface, borderRadius: radius.surface, gap: space.md, maxWidth: 420, padding: space.lg, width: '100%' },
  promptTitle: { color: color.ink, fontFamily: type.ticketBold, fontSize: 20, lineHeight: 25 },
  promptInput: { backgroundColor: color.canvas, borderColor: color.line, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, color: color.ink, fontSize: 16, minHeight: 50, paddingHorizontal: 14 },
  promptSubmit: { alignItems: 'center', backgroundColor: color.action, borderRadius: radius.control, justifyContent: 'center', minHeight: 50 },
  promptSubmitText: { color: color.surface, fontFamily: type.ticketBold, fontSize: 17 },
  promptCancel: { color: color.muted, fontSize: 14, textAlign: 'center' },
  promptOptions: { gap: space.sm },
  promptOption: { borderColor: color.line, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  promptOptionTitle: { color: color.ink, fontSize: 15, fontWeight: '700' },
  promptOptionBody: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  disabled: { opacity: 0.4 },
});
