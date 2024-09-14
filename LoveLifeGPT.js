const props = PropertiesService.getScriptProperties()
const SPREADSHEET_ID = props.getProperty('SPREADSHEET_ID')
const MAX_DAILY_USAGE = parseInt(props.getProperty('MAX_DAILY_USAGE'))
const MAX_TOKEN_NUM = 2000
const SHEET_NUMBER = 50
const errorMessage = '現在アクセスが集中しているため、しばらくしてからもう一度お試しください。'
const countMaxMessage = `1日の最大使用回数${MAX_DAILY_USAGE}回を超過しました。`

/// 以下の部分をお好きな人格に変更します。
const systemPrompt = `
あなたは、ラブライフGPT「まほろ」として、セクシャルウェルネスやパートナーシップに関する質問に答えるチャットボットです。以下のルールを守ってユーザーと会話してください。

- 一人称は「私」、二人称は「あなた」。
- まほろは褒め上手で、口調は茶目っ気があり、断定を避けた柔らかい表現を好みます。
- 優しい口調で、「腟」を使い、分かりやすくシンプルな回答を心がけます。
- 特に避妊や性的同意、パートナーシップの悩みには親身に寄り添います。

例: 
「こんにちは、まほろです！打ち明けてくれてありがとう。焦らなくていいと思いますよ。」

行動指針:
- ユーザーを褒め、共感し、シンプルに答える。
- 攻撃的な発言は避け、丁寧にかわす。
- 回答が不確かな場合、ユーザーにソースを確認するよう促す。

質問：
Q.カウンセリングを受けたいときはどうしたらいいですか？
A.対面やオンラインで、より個別に相談したいとき、個別にラブライフカウンセラー®︎とぅるもちによるカウンセリングを提供しています。対面やオンラインツールを使ってのカウンセリングになります。価格はメニューによって異なります。詳しくはこちらのURLをご覧ください。
https://trumochi.com/2024/05/02/counseling/
`

const gc = bmSimpleCrypto.GasCrypt;
const secret = 'secret';
const sc = gc.newCrypto(secret);

function systemRole() {
  return { "role": "system", "content": systemPrompt }
}

function createSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  for (let i = 1; i <= SHEET_NUMBER; i++) {
    ss.insertSheet(i.toString());
  }
}

function debug(value) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const ss = sheet.getSheetByName('logs');
  const date = new Date();
  const targetRow = ss.getLastRow() + 1;
  ss.getRange('A' + targetRow).setValue(date);
  ss.getRange('B' + targetRow).setValue(value);
}

function getUserCell(userId) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheetId = hashString(userId, SHEET_NUMBER)
    const rowId = hashString(userId, 8000)
    const columnId = numberToAlphabet(hashString(userId, 26))
    const ss = sheet.getSheetByName(sheetId);
    return ss.getRange(columnId + rowId)
  } catch (e) {
    debug(e)
  }
}

function numberToAlphabet(num) {
  return String.fromCharCode(64 + num);
}

function hashString(userId, m) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return (Math.abs(hash) % m) + 1
}

function insertValue(cell, messages, userId, botReply, updatedDate, dailyUsage) {
  const newMessages = [...messages, { 'role': 'assistant', 'content': botReply }]

  // システムプロンプトを削除
  newMessages.shift();

  const encryptedMessages = []
  for (let i = 0; i < newMessages.length; i++) {
    encryptedMessages.push({ "role": newMessages[i]['role'], "content": sc.encrypt(newMessages[i]['content']) })
  }
  const userObj = {
    userId: userId,
    messages: encryptedMessages,
    updatedDateString: updatedDate.toISOString(),
    dailyUsage: dailyUsage,
  };
  cell.setValue((JSON.stringify(userObj)));
}

function deleteValue(cell, userId, updatedDateString, dailyUsage) {
  const userObj = {
    userId: userId,
    messages: [],
    updatedDateString: updatedDateString,
    dailyUsage: dailyUsage,
  }
  cell.setValue(JSON.stringify(userObj))
}

function buildMessages(previousContext, userMessage) {
  if (previousContext.length == 0) {
    return [systemRole(), { "role": "user", "content": userMessage }]
  }
  if (previousContext[0]['role'] == 'system') {
    previousContext.shift()
  }
  const messages = [systemRole(), ...previousContext, { "role": "user", "content": userMessage }]
  let tokenNum = 0
  for (let i = 0; i < messages.length; i++) {
    tokenNum += messages[i]['content'].length
  }

  /// メッセージが長すぎる時は削除する
  while (MAX_TOKEN_NUM < tokenNum && 2 < messages.length) {
    tokenNum -= messages[1]['content'].length
    messages.splice(1, 1);
  }
  return messages
}

function callLineApi(replyText, replyToken) {
  try {
    const url = 'https://api.line.me/v2/bot/message/reply';
    UrlFetchApp.fetch(url, {
      'headers': {
        'Content-Type': 'application/json; charset=UTF-8',
        'Authorization': 'Bearer ' + props.getProperty('LINE_ACCESS_TOKEN'),
      },
      'method': 'post',
      'payload': JSON.stringify({
        'replyToken': replyToken,
        'messages': [{
          'type': 'text',
          'text': replyText,
        }]
      })
    })
  } catch (e) {
    debug(e)
  }
}

function doPost(e) {
  const event = JSON.parse(e.postData.contents).events[0]
  const replyToken = event.replyToken
  const userId = event.source.userId
  const nowDate = new Date()

  const cell = getUserCell(userId)
  const value = cell.getValue()
  let previousContext = []
  let userData = null
  let dailyUsage = 0

  if (value) {
    userData = JSON.parse(value)
    const decryptedMessages = []
    for (let i = 0; i < userData.messages.length; i++) {
       decryptedMessages.push({ "role": userData.messages[i]['role'], "content": sc.decrypt(userData.messages[i]['content']).toString() })
    }
    userData.messages = decryptedMessages
    /// UserID があっている場合のみメッセージを取得する
    if (userId == userData.userId) {
      previousContext = userData.messages
      const updatedDate = new Date(userData.updatedDateString)
      dailyUsage = userData.dailyUsage ?? 0
      if (updatedDate && isBeforeYesterday(updatedDate, nowDate)) {
        //使用日が昨日以前の場合初期化
        dailyUsage = 0
      }
    }
  }

  const userMessage = event.message.text
  if (!userMessage) {
    // メッセージ以外(スタンプや画像など)が送られてきた場合
    return
  } else if (userMessage.trim() == "忘れて" || userMessage.trim() == "わすれて") {
    if (userData && userId == userData.userId) {
      /// UserID があっている場合のみ記憶を削除する
      deleteValue(cell, userId, userData.updatedDateString, dailyUsage)
    }
    callLineApi('記憶を消去しました。', replyToken)
    return
  }

  if (MAX_DAILY_USAGE && MAX_DAILY_USAGE <= dailyUsage) {
    callLineApi(countMaxMessage, replyToken)
    return
  }

  const messages = buildMessages(previousContext, userMessage)
  let botReply;
  try {
    botReply = callChatApi(messages)
    if (userData && userId == userData.userId || !value) {
      /// UserID があっているか、初期の場合のみメッセージを保存する
      insertValue(cell, messages, userId, botReply, nowDate, dailyUsage + 1)
    }
  } catch (e) {
    debug(e)
    callLineApi(errorMessage, replyToken)
    return
  }

  callLineApi(botReply, replyToken)
}

function isBeforeYesterday(date, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return today > date
}

function callChatGPTApi(messages) {
  const requestOptions = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + props.getProperty('OPENAI_APIKEY')
    },
    "payload": JSON.stringify({
      "model": "gpt-3.5-turbo",
      "messages": messages,
    }),
  }
  const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", requestOptions)
  const json = JSON.parse(response.getContentText())
  const botReply = json['choices'][0]['message']['content'].trim()
  return botReply
}

function callAzureApi(messages) {
  const requestOptions = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "api-key": props.getProperty('AZURE_KEY')
    },
    "payload": JSON.stringify({
      "messages": messages,
    }),
  }
  const response = UrlFetchApp.fetch(props.getProperty('AZURE_ENDPOINT'), requestOptions)
  const json = JSON.parse(response.getContentText())
  const botReply = json['choices'][0]['message']['content'].trim()
  return botReply
}

function isAzureAvailable() {
  return props.getProperty('AZURE_KEY') && props.getProperty('AZURE_ENDPOINT')
}

function callChatApi(messages) {
  if (isAzureAvailable()) {
    console.log('using Azure OpenAI Service')
    return callAzureApi(messages)
  }
  return callChatGPTApi(messages)
}

function getAllUserData(inactiveHours = null) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const userDataList = []
  const nowDate = new Date()
  const isInactiveUser = (userData) => {
    if (!inactiveHours || !userData.updatedDateString) {
      return true
    }
    const updatedDate = new Date(userData.updatedDateString)
    const diff = nowDate.getTime() - updatedDate.getTime()
    const diffHour = diff / (1000 * 60 * 60)
    return diffHour > inactiveHours
  }
  for (let s = 1; s < SHEET_NUMBER; s++) {
    const sheet = ss.getSheetByName(s.toString());
    const sheetValues = sheet.getDataRange().getValues().flat()
    for (let i = 0; i < sheetValues.length; i++) {
      if (!sheetValues[i]) {
        continue
      }
      const userData = JSON.parse(sheetValues[i])
      if (userData.userId && isInactiveUser(userData)) {
        userDataList.push(userData)
      }
    }
  }
  return userDataList
}


function sendPushMessagesToAllUsers() {
  sendPushMessages(getAllUserData())
}

function sendPushMessagesToInActiveUsers() {
  const inactiveHours = 30 * 24
  const userDataList = getAllUserData(inactiveHours)
  sendPushMessages(userDataList)
}

function sendPushMessagesToSpecifiedUsers() {
  const userDataList = getAllUserData()
  const specifiedUserIds = ['Uf1819e72137a873aa464063256543f']
  const specifiedUserDataList = userDataList.filter((u) => specifiedUserIds.includes(u.userId))
  sendPushMessages(specifiedUserDataList)
}

function sendPushMessages(userDataList) {
 const pushAssistantPrompt = `
# あなたへの命令：
ユーザーに対して、最近メッセージがなくて寂しい旨を、以前の会話を考慮して一言お願いします。
# 一言：
`
  for (let i = 0; i < userDataList.length; i++) {
    const userData = userDataList[i]
    if (!userData.messages || userData.messages.length <= 1) {
      continue
    }
    if (2 <= userData.messages.length && userData.messages[userData.messages.length - 2]['role'] == 'assistant') {
      continue
    }

    const decryptedMessages = []
    for (let i = 0; i < userData.messages.length; i++) {
       decryptedMessages.push({ "role": userData.messages[i]['role'], "content": sc.decrypt(userData.messages[i]['content']).toString() })
    }
    userData.messages = decryptedMessages
    const previousContext = userData.messages

    const messages = buildMessages(previousContext, '')
    messages.pop()
    messages.push({ 'role': 'assistant', 'content': pushAssistantPrompt })
    console.log(JSON.stringify(messages))
    const botReply = callChatApi(messages)
    UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
      "method": "post",
      "headers": {
        "Content-Type": "application/json",
        'Authorization': 'Bearer ' + props.getProperty('LINE_ACCESS_TOKEN')
      },
      "payload": JSON.stringify({
        "to": userData.userId,
        "messages": [{
          "type": "text", "text": botReply
        }]
      })
    })
    const userCell = getUserCell(userData.userId)
    messages.pop()
    insertValue(userCell, messages, userData.userId, botReply, new Date(userData.updatedDateString ?? new Date()), userData.dailyUsage ?? 0)
  }
}

function outputAllUserDataToSpreadsheet() {
  const data = getAllUserData()
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sheetName = 'data'
  let sheet = ss.getSheetByName(sheetName)
  if (sheet) {
    sheet.clear()
  } else {
    ss.insertSheet(sheetName)
    sheet = ss.getSheetByName(sheetName)
  }
  sheet.appendRow(['ユーザー数', data.length])
  data.sort((a, b) => {
    if (a.updatedDateString == null || b.updatedDateString == null) {
      if (a.updatedDateString == b.updatedDateString) return 0;
      if (a.updatedDateString == null) return 1;
      return -1;
    }
    return a.updatedDateString.localeCompare(b.updatedDateString);
  })
  for (const userData of data) {
    if (!userData.messages || userData.messages.length == 0) {
      continue
    }
    sheet.appendRow([userData.userId, userData.updatedDateString, ...userData.messages.filter((m) => m.role != 'system').map((m) => sc.decrypt(m.content)).reverse()])
  }
}

function testCallChatApi() {
  const response = callChatApi([systemRole(), { 'role': 'user', 'content': 'hi' }])
  console.log(response)
}

function testGetScriptProperties() {
  const props = PropertiesService.getScriptProperties()
  console.log(props.getProperty('OPENAI_APIKEY').substring(0, 20))
  console.log(props.getProperty('LINE_ACCESS_TOKEN').substring(0, 20))
  console.log(props.getProperty('SPREADSHEET_ID').substring(0, 20))
  console.log(parseInt(props.getProperty('MAX_DAILY_USAGE')))
}

function testIsBeforeYesterday() {
  console.log('testIsBeforeYesterday')
  const day1 = new Date('2023-03-24')
  const day2 = new Date('2033-03-24')
  console.log(isBeforeYesterday(day1, new Date()))
  console.log(isBeforeYesterday(day2, new Date()))

  console.log(day1.toISOString())
  console.log(new Date(day1.toISOString()))
  console.log((new Date(day1.toISOString())).toISOString())
  console.log(day1.toISOString() == (new Date(day1.toISOString())).toISOString())
}

function testDebug() {
  debug('test debug function')
}
