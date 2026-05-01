export async function performSocialAction(targetUserId, action) {
  const targetId = Number(targetUserId);
  if (!targetId) {
    throw new Error('Некорректный пользователь.');
  }

  let url = '';
  let method = 'POST';

  switch (action) {
    case 'send_request':
      url = `/api/friends/${targetId}/request`;
      method = 'POST';
      break;
    case 'cancel_request':
      url = `/api/friends/${targetId}/request`;
      method = 'DELETE';
      break;
    case 'accept_request':
      url = `/api/friends/${targetId}/accept`;
      method = 'POST';
      break;
    case 'reject_request':
      url = `/api/friends/${targetId}/reject`;
      method = 'DELETE';
      break;
    case 'remove_friend':
      url = `/api/friends/${targetId}`;
      method = 'DELETE';
      break;
    case 'follow':
      url = `/api/users/${targetId}/subscribe`;
      method = 'POST';
      break;
    case 'unfollow':
      url = `/api/users/${targetId}/subscribe`;
      method = 'DELETE';
      break;
    default:
      throw new Error('Неизвестное действие.');
  }

  const response = await fetch(url, { method });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || 'Не удалось выполнить действие.');
  }

  return data;
}
