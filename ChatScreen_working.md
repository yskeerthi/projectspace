import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  Alert,
  Image,
  Pressable,
  Dimensions,
  SafeAreaView,
  Platform,
  StatusBar,
  Keyboard,
  KeyboardAvoidingView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import socket from '../utils/socket';
import axios from 'axios';

const API_URL = 'http://192.168.137.1:5000';
const { width, height } = Dimensions.get('window');

const COLORS = {
  primary: '#34e3b0',
  secondary: '#34e3b0',
  background: '#f6fbfa',
  ownMessage: '#E8F4EA',
  otherMessage: '#FFFFFF',
  recording: '#34e3b0',
};

export default function ChatScreen({ navigation, route }) {
  const { otherUserId, otherUserName } = route.params;
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [recording, setRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioPermission, setAudioPermission] = useState(false);
  const [sound, setSound] = useState(null);
  const [playingMessageId, setPlayingMessageId] = useState(null);
  const [playbackPosition, setPlaybackPosition] = useState({});
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inputContainerHeight, setInputContainerHeight] = useState(0);

  const flatRef = useRef(null);
  const recordingTimer = useRef(null);
  const isStartingOrStopping = useRef(false);

  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => <Text style={styles.headerTitle}>{otherUserName}</Text>,
      headerRight: () => (
        <TouchableOpacity onPress={() => setMenuVisible(true)} style={{ paddingRight: 12 }}>
          <Ionicons name="ellipsis-vertical" size={24} color="white" />
        </TouchableOpacity>
      ),
      headerStyle: { backgroundColor: COLORS.primary },
      headerTintColor: 'white',
    });
  }, [otherUserName, navigation]);

  const scrollToBottom = useCallback(() => {
    if (flatRef.current) {
      requestAnimationFrame(() => {
        flatRef.current.scrollToEnd({ animated: true });
      });
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const id = await AsyncStorage.getItem('currentUserId') || 'user1';
      setCurrentUserId(id);

      await setupAudio();

      socket.connect();
      socket.emit('setup', id);

      socket.on('receiveMessage', (msg) => {
        if (msg.senderId === otherUserId && msg.receiverId === id) {
          setMessages((prev) => [...prev, msg]);
          scrollToBottom();
        }
      });

      try {
        const res = await axios.get(`${API_URL}/api/messages/history/${id}/${otherUserId}`);
        setMessages(res.data);
        scrollToBottom();
      } catch (error) {
        console.error('Error fetching messages:', error);
        Alert.alert('Error', 'Failed to load message history.');
      }
    };
    init();

    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      scrollToBottom();
    });
    const keyboardDidHideListener = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
      scrollToBottom();
    });

    return () => {
      socket.off('receiveMessage');
      socket.disconnect();
      if (recordingTimer.current) clearInterval(recordingTimer.current);
      if (recording) recording.stopAndUnloadAsync().catch(() => {});
      if (sound) sound.unloadAsync().catch(() => {});
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, [otherUserId, scrollToBottom]);

  const setupAudio = async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'This app needs microphone access for voice messages.',
            buttonPositive: 'OK',
          }
        );
        setAudioPermission(granted === PermissionsAndroid.RESULTS.GRANTED);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('Permission Denied', 'Microphone access is required for voice messages.');
        }
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        setAudioPermission(status === 'granted');
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Microphone access is required for voice messages.');
        }
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
        shouldDuckAndroid: true,
        interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('Audio setup failed:', error);
      Alert.alert('Error', 'Failed to initialize audio settings.');
    }
  };

  const uploadAudio = async (audioUri, messageId) => {
    const formData = new FormData();
    formData.append('audio', {
      uri: audioUri,
      name: `audio-${messageId}.m4a`,
      type: 'audio/m4a',
    });

    try {
      const uploadRes = await axios.post(`${API_URL}/api/upload-audio`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return uploadRes.data.url;
    } catch (error) {
      console.error('Error uploading audio:', error.response?.data || error.message);
      Alert.alert('Error', 'Failed to upload audio file.');
      return null;
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    const payload = {
      id: Date.now().toString(),
      senderId: currentUserId,
      receiverId: otherUserId,
      text: newMessage,
      type: 'text',
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, payload]);
    setNewMessage('');
    socket.emit('sendMessage', payload);

    try {
      await axios.post(`${API_URL}/api/messages/send`, payload);
    } catch (error) {
      console.error('Error sending message payload:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    }

    scrollToBottom();
  };

  const sendImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        quality: 0.8,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        aspect: [4, 16],
      });

      if (!result.canceled && result.assets.length > 0) {
        const img = result.assets[0];
        const payload = {
          id: Date.now().toString(),
          senderId: currentUserId,
          receiverId: otherUserId,
          text: img.uri,
          type: 'image',
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, payload]);
        socket.emit('sendMessage', payload);
        await axios.post(`${API_URL}/api/messages/send`, payload);
        scrollToBottom();
      }
    } catch (error) {
      console.error('Error sending image:', error);
      Alert.alert('Error', 'Failed to send image. Please try again.');
    }
  };

  const sendDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
      if (!result.canceled && result.assets.length > 0) {
        const file = result.assets[0];
        const payload = {
          id: Date.now().toString(),
          senderId: currentUserId,
          receiverId: otherUserId,
          text: file.uri,
          type: 'document',
          fileName: file.name,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, payload]);
        socket.emit('sendMessage', payload);
        await axios.post(`${API_URL}/api/messages/send`, payload);
        scrollToBottom();
      }
    } catch (error) {
      console.error('Error sending document:', error);
      Alert.alert('Error', 'Failed to send document. Please try again.');
    }
  };

  const startRecording = async () => {
    if (!audioPermission) {
      Alert.alert('Permission Denied', 'Microphone access is required to record voice messages.');
      return;
    }

    if (isStartingOrStopping.current || isRecording) {
      return;
    }

    isStartingOrStopping.current = true;

    try {
      if (sound) {
        await sound.unloadAsync();
        setSound(null);
        setPlayingMessageId(null);
      }

      if (recording) {
        try {
          await recording.stopAndUnloadAsync();
        } catch (err) {
          console.error('Error cleaning up previous recording:', err);
        }
        setRecording(null);
      }

      setIsRecording(true);
      setRecordingDuration(0);

      const recordingOptions = {
        android: {
          extension: '.m4a',
          outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
          audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
      };
      const { recording: newRecording } = await Audio.Recording.createAsync(recordingOptions);
      setRecording(newRecording);
      recordingTimer.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Recording failed to start:', error);
      Alert.alert('Error', 'Failed to start recording.');
      setIsRecording(false);
      setRecording(null);
      setRecordingDuration(0);
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }
    } finally {
      isStartingOrStopping.current = false;
    }
  };

  const stopRecording = async () => {
    if (isStartingOrStopping.current || !recording) {
      setIsRecording(false);
      setRecording(null);
      setRecordingDuration(0);
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }
      isStartingOrStopping.current = false;
      return;
    }

    isStartingOrStopping.current = true;

    try {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }

      const uri = recording.getURI();
      await recording.stopAndUnloadAsync();
      setRecording(null);

      if (uri && recordingDuration >= 1) {
        const messageId = Date.now().toString();
        const publicAudioUrl = await uploadAudio(uri, messageId);

        if (!publicAudioUrl) {
          Alert.alert('Error', 'Failed to upload audio. Message not sent.');
          return;
        }

        const payload = {
          id: messageId,
          senderId: currentUserId,
          receiverId: otherUserId,
          text: publicAudioUrl,
          type: 'audio',
          duration: recordingDuration,
          createdAt: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, payload]);
        socket.emit('sendMessage', payload);

        try {
          await axios.post(`${API_URL}/api/messages/send`, payload);
        } catch (error) {
          console.error('Error sending voice message payload:', error);
          Alert.alert('Error', 'Failed to save voice message.');
        }

        scrollToBottom();
      } else {
        Alert.alert('Recording Too Short', 'Voice message must be at least 1 second long.');
      }
    } catch (error) {
      console.error('Error during stop recording or sending:', error);
      Alert.alert('Error', 'Failed to stop recording or send voice message.');
    } finally {
      setIsRecording(false);
      setRecording(null);
      setRecordingDuration(0);
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }
      isStartingOrStopping.current = false;
    }
  };

  const toggleVoicePlayback = async (audioUri, messageId) => {
    if (!audioUri || typeof audioUri !== 'string') {
      Alert.alert('Error', 'Invalid audio file.');
      return;
    }

    try {
      if (playingMessageId === messageId && sound) {
        const status = await sound.getStatusAsync();
        if (status.isLoaded && status.isPlaying) {
          await sound.pauseAsync();
          setPlayingMessageId(null);
          return;
        }
      }
      if (sound) {
        await sound.unloadAsync();
        setSound(null);
      }
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true, isLooping: false }
      );
      setSound(newSound);
      setPlayingMessageId(messageId);
      newSound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded) {
          if (status.didJustFinish) {
            setPlayingMessageId(null);
            setPlaybackPosition((prev) => ({ ...prev, [messageId]: 0 }));
          } else if (status.isPlaying) {
            const position = Math.floor(status.positionMillis / 1000);
            setPlaybackPosition((prev) => ({ ...prev, [messageId]: position }));
          }
        }
      });
    } catch (error) {
      console.error('Voice playback failed:', error);
      Alert.alert('Playback Error', 'Failed to play audio.');
    }
  };

  const openImageModal = (imageUri) => {
    setSelectedImage(imageUri);
    setImageModalVisible(true);
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return `${date.getDate()} ${date.toLocaleString('default', { month: 'short' })}, ${date.getFullYear()}`;
  };

  const onInputContainerLayout = (event) => {
    const { height } = event.nativeEvent.layout;
    if (height !== inputContainerHeight) {
      setInputContainerHeight(height);
    }
  };

  const renderMessage = useCallback(
    ({ item, index }) => {
      const isOwnMessage = item.senderId === currentUserId;
      const isPlaying = playingMessageId === item.id;
      const currentPosition = playbackPosition[item.id] || 0;
      const messageId = item.id || index.toString();

      const showDate =
        index === 0 ||
        new Date(item.createdAt).toDateString() !==
          new Date(messages[index - 1]?.createdAt).toDateString();

      return (
        <View>
          {showDate && (
            <View style={styles.dateContainer}>
              <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
            </View>
          )}

          <View
            style={[
              styles.messageContainer,
              isOwnMessage ? styles.ownMessageContainer : styles.otherMessageContainer,
            ]}
          >
            <Pressable onLongPress={() => console.log('Long pressed message:', item.id)}>
              <View
                style={[
                  styles.messageBubble,
                  isOwnMessage ? styles.ownMessage : styles.otherMessage,
                ]}
              >
                {item.type === 'image' ? (
                  <TouchableOpacity onPress={() => openImageModal(item.text)}>
                    <Image source={{ uri: item.text }} style={styles.imageMessage} />
                  </TouchableOpacity>
                ) : item.type === 'audio' ? (
                  <TouchableOpacity
                    onPress={() => toggleVoicePlayback(item.text, messageId)}
                    style={styles.voiceMessage}
                  >
                    <View
                      style={[
                        styles.playButton,
                        isOwnMessage ? styles.playButtonOwn : styles.playButtonOther,
                      ]}
                    >
                      <Ionicons
                        name={isPlaying ? 'pause' : 'play'}
                        size={20}
                        color={isOwnMessage ? COLORS.primary : 'white'}
                      />
                    </View>

                    <View style={styles.voiceInfo}>
                      <View style={styles.waveform}>
                        {[...Array(20)].map((_, i) => (
                          <View
                            key={i}
                            style={[
                              styles.waveBar,
                              {
                                height: Math.random() * 20 + 8,
                                backgroundColor: isOwnMessage ? '#25D366' : '#128C7E',
                                opacity:
                                  isPlaying && (currentPosition / (item.duration || 1)) * 20 > i
                                    ? 1
                                    : 0.4,
                              },
                            ]}
                          />
                        ))}
                      </View>

                      <Text
                        style={[styles.voiceTime, { color: isOwnMessage ? '#25D366' : '#666' }]}
                      >
                        {isPlaying
                          ? formatDuration(currentPosition)
                          : formatDuration(item.duration || 0)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ) : item.type === 'document' ? (
                  <TouchableOpacity style={styles.documentMessage}>
                    <Ionicons
                      name="document"
                      size={20}
                      color={isOwnMessage ? COLORS.primary : COLORS.secondary}
                    />
                    <Text style={[styles.documentText, { color: isOwnMessage ? '#000' : '#000' }]}>
                      📄 {item.fileName || 'Document'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={[styles.messageText, { color: isOwnMessage ? '#000' : '#000' }]}>
                    {item.text}
                  </Text>
                )}

                <Text style={[styles.messageTime, { color: isOwnMessage ? '#666' : '#999' }]}>
                  {formatTime(item.createdAt)}
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
      );
    },
    [currentUserId, playingMessageId, playbackPosition, messages]
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : -50}
      >
        <FlatList
          ref={flatRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item, index) => item.id || index.toString()}
          style={styles.messagesList}
          contentContainerStyle={{
            paddingVertical: 10,
            paddingHorizontal: 8,
            paddingBottom: inputContainerHeight + 10,
          }}
          onContentSizeChange={scrollToBottom}
          onLayout={scrollToBottom}
        />

        {isRecording && (
          <View style={[styles.recordingIndicator, { bottom: inputContainerHeight }]}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>Recording... {formatDuration(recordingDuration)}</Text>
            <Text style={styles.recordingHint}>Release to send</Text>
          </View>
        )}

        <View
          style={[styles.inputContainer, { bottom: 0 }]}
          onLayout={onInputContainerLayout}
        >
          <View style={styles.inputRow}>
            <TouchableOpacity onPress={sendImage} style={styles.attachButton}>
              <Ionicons name="image" size={24} color={COLORS.secondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={sendDocument} style={styles.attachButton}>
              <Ionicons name="attach" size={24} color={COLORS.secondary} />
            </TouchableOpacity>

            <TextInput
              style={styles.textInput}
              placeholder="Type a message"
              placeholderTextColor="#999"
              value={newMessage}
              onChangeText={setNewMessage}
              multiline
              maxLength={1000}
            />

            {newMessage.trim() ? (
              <TouchableOpacity onPress={sendMessage} style={styles.sendButton}>
                <Ionicons name="send" size={20} color="white" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPressIn={startRecording}
                onPressOut={stopRecording}
                style={[styles.micButton, isRecording && styles.micButtonActive]}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={isRecording ? 'stop' : 'mic'}
                  size={24}
                  color={isRecording ? 'white' : COLORS.primary}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Modal
          visible={imageModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setImageModalVisible(false)}
        >
          <View style={styles.imageModalContainer}>
            <StatusBar backgroundColor="black" barStyle="light-content" />
            <TouchableOpacity
              style={styles.imageModalClose}
              onPress={() => setImageModalVisible(false)}
            >
              <Ionicons name="close" size={30} color="white" />
            </TouchableOpacity>
            <Image
              source={{ uri: selectedImage }}
              style={styles.fullScreenImage}
              resizeMode="contain"
            />
          </View>
        </Modal>

        <Modal visible={menuVisible} transparent animationType="fade">
          <TouchableOpacity
            style={styles.menuOverlay}
            onPress={() => setMenuVisible(false)}
          />
          <View style={styles.menuBox}>
            {['Search', 'Clear Chat', 'Mute Notifications', 'Block'].map((item) => (
              <TouchableOpacity
                key={item}
                style={styles.menuItem}
                onPress={() => {
                  if (item === 'Clear Chat') {
                    Alert.alert(
                      'Clear Chat',
                      'Are you sure you want to clear all messages from this chat?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Clear', onPress: () => setMessages([]) },
                      ]
                    );
                  }
                  setMenuVisible(false);
                }}
              >
                <Text style={styles.menuText}>{item}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  headerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  messagesList: {
    flex: 1,
  },
  dateContainer: {
    alignSelf: 'center',
    marginVertical: 10,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  dateText: {
    color: '#555',
    fontSize: 12,
  },
  messageContainer: {
    marginVertical: 4,
    maxWidth: '80%',
  },
  ownMessageContainer: {
    alignSelf: 'flex-end',
  },
  otherMessageContainer: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    borderRadius: 8,
    padding: 10,
    minWidth: 80,
    flexDirection: 'column',
    alignItems: 'flex-end',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  ownMessage: {
    backgroundColor: COLORS.ownMessage,
    borderBottomRightRadius: 2,
  },
  otherMessage: {
    backgroundColor: COLORS.otherMessage,
    borderBottomLeftRadius: 2,
  },
  messageText: {
    fontSize: 16,
    marginBottom: 4,
  },
  imageMessage: {
    width: 200,
    height: 800,
    borderRadius: 8,
    resizeMode: 'cover',
    marginBottom: 4,
  },
  documentMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
  },
  documentText: {
    marginLeft: 8,
    fontSize: 16,
    textDecorationLine: 'underline',
  },
  voiceMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 150,
    paddingVertical: 4,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  playButtonOwn: {
    backgroundColor: 'white',
  },
  playButtonOther: {
    backgroundColor: COLORS.primary,
  },
  voiceInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 30,
    flexGrow: 1,
    marginRight: 10,
  },
  waveBar: {
    width: 3,
    marginHorizontal: 1,
    borderRadius: 1,
  },
  voiceTime: {
    fontSize: 12,
  },
  messageTime: {
    fontSize: 10,
    alignSelf: 'flex-end',
  },
  inputContainer: {
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    justifyContent: 'center',
    minHeight: 50,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#FFFFFF',
    borderRadius: 25,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxHeight: 120,
  },
  attachButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 10,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  micButtonActive: {
    backgroundColor: COLORS.recording,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 10,
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.recording,
    marginRight: 10,
  },
  recordingText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  recordingHint: {
    color: '#ccc',
    fontSize: 12,
    marginLeft: 10,
  },
  imageModalContainer: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageModalClose: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 40 : 10,
    right: 10,
    zIndex: 1,
    padding: 10,
  },
  fullScreenImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height - (Platform.OS === 'ios' ? 80 : 20),
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  menuBox: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 38 : 50,
    right: 10,
    backgroundColor: 'white',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    paddingVertical: 5,
  },
  menuItem: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  menuText: {
    fontSize: 16,
    color: '#333',
  },
});
