// 全局變數
let productData = [];
let monitoredProducts = []; // 追蹤已監控的商品
let pageMonitoringInterval = null; // 頁面監控輪詢間隔
let isPageMonitoring = false; // 是否正在監控當前頁面
let autoCheckoutEnabled = false; // 是否啟用自動結帳
let refreshIntervalSeconds = 30; // 刷新間隔，預設30秒

// 監聽來自彈出視窗和背景腳本的消息
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type === 'fetchProducts') {
    fetchAllProducts().then(products => {
      // 將抓取到的產品發送回彈出視窗
      chrome.runtime.sendMessage({
        type: 'productsFetched',
        products: products
      });
      
      // 將產品添加到監控列表
      products.forEach(product => {
        chrome.runtime.sendMessage({
          type: 'addProductToMonitor',
          product: product
        });
      });
      
      sendResponse({success: true, count: products.length});
    }).catch(error => {
      console.error('抓取產品時出錯:', error);
      sendResponse({success: false, error: error.message});
    });
    
    return true; // 表示將非同步回應
  } else if (message.type === 'checkStock') {
    checkProductStock(message.product, message.autoCheckout).then(result => {
      sendResponse(result);
    }).catch(error => {
      console.error('檢查庫存時出錯:', error);
      sendResponse({success: false, error: error.message});
    });      return true; // 表示將非同步回應  } else if (message.type === 'startPageMonitoring') {
    startPageMonitoring(message.autoCheckout, message.refreshInterval, message.isSequential, message.currentIndex, message.totalProducts);
    sendResponse({success: true, message: '開始頁面監控'});
    return true;
  } else if (message.type === 'stopPageMonitoring') {
    stopPageMonitoring();
    sendResponse({success: true, message: '停止頁面監控'});
    return true;
  } else if (message.type === 'updateRefreshInterval') {
    updateRefreshInterval(message.interval);
    sendResponse({success: true, message: '更新刷新間隔'});
    return true;
  } else if (message.type === 'initiateCheckout') {
    initiateCheckout(message.product).then(result => {
      sendResponse(result);
    }).catch(error => {
      console.error('結帳過程出錯:', error);
      sendResponse({success: false, error: error.message});
    });
    
    return true; // 表示將非同步回應
  } else if (message.type === 'getMonitoredProducts') {
    // 回傳當前已監控的產品列表
    chrome.storage.sync.get('monitoredProducts', function(data) {
      monitoredProducts = data.monitoredProducts || [];
      sendResponse({success: true, products: monitoredProducts});
    });
    return true; // 表示將非同步回應
  }
});

// 抓取所有產品
async function fetchAllProducts() {
  // 判斷當前頁面類型
  if (isProductListPage()) {
    return fetchProductsFromListPage();
  } else if (isProductPage()) {
    const product = await extractProductInfo();
    return product ? [product] : [];
  } else if (window.location.pathname === '/') {
    // 首頁，嘗試找到所有產品列表鏈接
    return fetchProductsFromHomePage();
  }
  
  return [];
}

// 判斷是否為產品列表頁
function isProductListPage() {
  // 檢查URL是否包含 "/collections/" 或典型的商品列表頁面特徵
  return window.location.pathname.includes('/collections/') || 
         document.querySelectorAll('.product-grid, .collection-grid, .products-list').length > 0;
}

// 判斷是否為單一產品頁
function isProductPage() {
  // 檢查URL是否包含 "/products/" 或典型的產品頁面特徵
  return window.location.pathname.includes('/products/') || 
         document.querySelectorAll('.product-single, .product-details, [data-product-form]').length > 0;
}

// 從產品列表頁抓取產品
async function fetchProductsFromListPage() {
  const products = [];
  
  // 尋找所有產品卡片的選擇器
  // 以下選擇器是基於常見購物網站的產品列表結構，可能需要針對 soorploomclothier.com 調整
  const productCards = document.querySelectorAll('.product-card, .product-item, .product, [data-product-card]');
  
  for (const card of productCards) {
    try {
      const linkElement = card.querySelector('a[href*="/products/"]');
      if (!linkElement) continue;
      
      const productUrl = new URL(linkElement.href).href;
      const nameElement = card.querySelector('.product-title, .product-name, h2, h3');
      const priceElement = card.querySelector('.price, .product-price, [data-product-price]');
      const imageElement = card.querySelector('img');
        let inStock = false;
      const addToCartButton = card.querySelector('[name="add"], [data-add-to-cart], .add-to-cart, .product-form__cart-submit');
      if (addToCartButton && !addToCartButton.disabled) {
        inStock = true;
      }
      
      const product = {
        name: nameElement ? nameElement.textContent.trim() : '未知商品',
        price: priceElement ? priceElement.textContent.trim() : '價格未知',
        url: productUrl,
        image: imageElement ? imageElement.src : '',
        inStock: inStock
      };
      
      products.push(product);
    } catch (error) {
      console.error('處理產品卡片時出錯:', error);
    }
  }
  
  return products;
}

// 從首頁抓取產品
async function fetchProductsFromHomePage() {
  // 尋找指向產品集合的鏈接
  const collectionLinks = Array.from(document.querySelectorAll('a[href*="/collections/"]'))
    .filter(link => !link.href.includes('/products/')) // 排除指向產品頁面的鏈接
    .map(link => link.href);
  
  // 如果找到了收藏集鏈接，我們將打開一個新標籤頁並抓取
  if (collectionLinks.length > 0) {
    const uniqueLinks = [...new Set(collectionLinks)]; // 去除重複鏈接
    
    // 通知用戶我們正在抓取集合
    chrome.runtime.sendMessage({
      type: 'statusUpdate',
      message: `在首頁找到 ${uniqueLinks.length} 個商品集合，正在抓取...`
    });
    
    // 當前只處理第一個集合鏈接
    window.location.href = uniqueLinks[0];
    return [];
  }
  
  // 嘗試直接從首頁提取產品卡片
  return fetchProductsFromListPage();
}

// 提取產品詳細資訊
async function extractProductInfo() {
  try {
    // 找到產品標題
    const titleElement = document.querySelector('.product-title, .product-name, h1, [data-product-title]');
    const title = titleElement ? titleElement.textContent.trim() : document.title;
      // 找到產品價格 - 更新選擇器以匹配網站結構
    const priceElement = document.querySelector('.theme-money, .price, .product-price, [data-product-price]');
    const price = priceElement ? priceElement.textContent.trim() : '價格未知';
      // 找到產品庫存狀態 - 檢查「加入購物車」按鈕是否存在且未被禁用
    let inStock = false;
    const addToCartButton = document.querySelector('button[type="submit"][name="add"], button[name="add"], [data-add-to-cart], .add-to-cart, #AddToCart, .product-form__cart-submit, [data-button-action="add-to-cart"]');
    if (addToCartButton && !addToCartButton.disabled) {
      inStock = true;
    }
    
    // 尋找可用尺寸
    const sizeElements = document.querySelectorAll('select[name="options[Size]"] option, .swatch-element, [data-value*="size"], [data-variant-option="size"]');
    const sizes = [];
    
    sizeElements.forEach(el => {
      if (el.value && el.value !== 'Size' && !el.disabled) {
        sizes.push(el.value);
      } else if (el.dataset.value) {
        sizes.push(el.dataset.value);
      } else if (el.textContent.trim()) {
        sizes.push(el.textContent.trim());
      }
    });
    
    // 尋找顏色信息
    let color = '';
    
    // 方法 1: 通過選定的選項
    const colorSelect = document.querySelector('select[data-option="color"], select[id="option-color"], select[name*="Color"], select[id*="color"]');
    if (colorSelect && colorSelect.options && colorSelect.selectedIndex >= 0) {
      const selectedOption = colorSelect.options[colorSelect.selectedIndex];
      color = selectedOption.textContent.trim();
    }
    
    // 方法 2: 通過 selected-color-name 元素
    if (!color) {
      const colorNameSpan = document.querySelector('.selected-color-name');
      if (colorNameSpan) {
        color = colorNameSpan.textContent.trim();
      }
    }
    
    // 方法 3: 通過顏色樣本
    if (!color) {
      const activeColorSwatch = document.querySelector('.color-swatch.active');
      if (activeColorSwatch) {
        color = activeColorSwatch.getAttribute('data-value') || '';
      }
    }
    
    // 方法 4: 通過活動的顏色選項
    if (!color) {
      const activeColorOption = document.querySelector('.clickyboxes a.active, .opt-color.active');
      if (activeColorOption) {
        color = activeColorOption.getAttribute('data-value') || activeColorOption.textContent.trim();
      }
    }
    
    // 找到產品圖片
    const imageElement = document.querySelector('.product-featured-image, .product-image, [data-product-image]');
    const imageUrl = imageElement ? imageElement.src : '';
    
    // 獲取當前URL
    const productUrl = window.location.href;
    
    return {
      name: title,
      price: price,
      inStock: inStock,
      sizes: sizes.length > 0 ? sizes : null,
      color: color || null,
      url: productUrl,
      image: imageUrl
    };
  } catch (error) {
    console.error('提取產品資訊時出錯:', error);
    return null;
  }
}

// 添加當前商品到監控列表
async function addCurrentProductToMonitor() {
  if (!isProductPage()) {
    showNotification('請在商品頁面使用此功能');
    return;
  }
  
  try {
    // 提取商品資訊
    const product = await extractProductInfo();
    if (!product) {
      showNotification('無法提取商品資訊');
      return;
    }
    
    // 獲取用戶輸入的數量
    const quantityInput = document.getElementById('soorploom-quantity');
    const quantity = quantityInput ? parseInt(quantityInput.value, 10) : 1;
    
    // 將數量添加到商品資訊中
    product.quantity = quantity;
    
    // 將商品添加到監控列表
    chrome.runtime.sendMessage({
      type: 'addProductToMonitor',
      product: product
    });
    
    // 保存到本地變數
    chrome.storage.sync.get('monitoredProducts', function(data) {
      monitoredProducts = data.monitoredProducts || [];
      // 更新顯示的監控列表
      updateMonitoredProductsList();
    });
    
    showNotification(`已將 ${product.name} (${quantity} 件) 添加到監控列表`);
  } catch (error) {
    console.error('添加商品到監控列表時出錯:', error);
    showNotification('添加商品到監控列表時出錯: ' + error.message);
  }
}

// 檢查所有監控商品的庫存
function checkAllMonitoredProducts() {
  // 使用新的頁面監控邏輯
  chrome.runtime.sendMessage({
    type: 'startMonitoring',
    settings: {
      autoCheckout: false
    }
  });
  
  showNotification('已開始在當前頁面監控庫存');
}

// 顯示通知
function showNotification(message) {
  // 創建通知元素
  let notification = document.getElementById('soorploom-notification');
  
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'soorploom-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background-color: #4CAF50;
      color: white;
      padding: 16px;
      border-radius: 4px;
      z-index: 10000;
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      transition: opacity 0.3s;
    `;
    document.body.appendChild(notification);
  }
  
  notification.textContent = message;
  notification.style.opacity = '1';
  
  // 3秒後隱藏通知
  setTimeout(() => {
    notification.style.opacity = '0';
  }, 3000);
}

// 更新監控列表顯示
function updateMonitoredProductsList() {
  chrome.storage.sync.get('monitoredProducts', function(data) {
    monitoredProducts = data.monitoredProducts || [];
    
    // 移除現有列表
    let existingList = document.getElementById('soorploom-monitored-list');
    if (existingList) {
      existingList.remove();
    }
    
    // 創建監控列表容器
    const container = document.createElement('div');
    container.id = 'soorploom-monitored-list';
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background-color: white;
      border-radius: 4px;
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      padding: 16px;
      max-width: 350px;
      max-height: 400px;
      overflow-y: auto;
      z-index: 10000;
    `;
    
    // 添加標題
    const title = document.createElement('h3');
    title.textContent = '監控商品列表';
    title.style.marginTop = '0';
    container.appendChild(title);
    
    // 添加監控商品
    if (monitoredProducts.length === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.textContent = '尚未添加任何商品到監控列表';
      container.appendChild(emptyMsg);
    } else {
      const list = document.createElement('ul');
      list.style.padding = '0';
      list.style.margin = '0';
      list.style.listStyle = 'none';
      
      monitoredProducts.forEach(product => {
        const item = document.createElement('li');
        item.style.padding = '8px 0';
        item.style.borderBottom = '1px solid #eee';
        
        const nameLink = document.createElement('a');
        nameLink.href = product.url;
        nameLink.target = '_blank';
        nameLink.textContent = product.name;
        nameLink.style.color = '#0066cc';
        nameLink.style.textDecoration = 'none';
        
        const status = document.createElement('span');
        status.textContent = product.inStock ? ' (有庫存)' : ' (無庫存)';
        status.style.color = product.inStock ? 'green' : 'red';
        
        const price = document.createElement('div');
        price.textContent = `價格: ${product.price}`;
        price.style.fontSize = '0.9em';
        price.style.color = '#666';
        
        item.appendChild(nameLink);
        item.appendChild(status);
        item.appendChild(price);
        list.appendChild(item);
      });
      
      container.appendChild(list);
    }
    
    document.body.appendChild(container);
  });
}

// 檢查產品庫存
async function checkProductStock(product, autoCheckout) {
  try {
    // 提取當前頁面的產品信息
    const currentProduct = await extractProductInfo();
    
    if (!currentProduct) {
      return {success: false, message: '無法提取產品信息'};
    }
    
    // 保留原有的數量資訊或使用預設值
    if (!currentProduct.quantity && product.quantity) {
      currentProduct.quantity = product.quantity;
    }
    
    // 更新產品信息
    const updatedProduct = {...product, ...currentProduct};
    
    // 發送庫存更新消息
    chrome.runtime.sendMessage({
      type: 'stockUpdate',
      product: updatedProduct,
      inStock: updatedProduct.inStock,
      autoCheckout: autoCheckout
    });
    
    return {success: true, product: updatedProduct};
  } catch (error) {
    console.error('檢查庫存時出錯:', error);
    return {success: false, error: error.message};
  }
}

// 執行自動結帳流程
async function initiateCheckout(product) {
  try {
    console.log('開始自動結帳流程:', product);
    
    // 如果不在產品頁面，則導航到產品頁面
    if (!isProductPage()) {
      console.log('不在產品頁面，正在導航至:', product.url);
      window.location.href = product.url;
      return {success: false, message: '正在導航到產品頁面'};
    }
    
    // 設定購買數量（如果有指定）
    if (product.quantity && product.quantity > 1) {
      console.log('設定購買數量:', product.quantity);
      setQuantity(product.quantity);
    }
    
    // 點擊"加入購物車"按鈕
    console.log('嘗試加入購物車');
    const addToCartResult = clickAddToCart();
    if (!addToCartResult.success) {
      console.error('加入購物車失敗:', addToCartResult.message);
      return addToCartResult;
    }
    
    console.log('成功加入購物車，等待購物車更新');
    // 等待購物車更新 - 增加等待時間
    await wait(3500);
    
    // 檢查是否有確認對話框或彈出窗口需要處理
    handlePopups();
    
    // 點擊"Checkout"按鈕
    console.log('嘗試進入結帳頁面');
    const checkoutResult = clickCheckoutButton();
    if (!checkoutResult.success) {
      console.error('點擊結帳按鈕失敗:', checkoutResult.message);
      return checkoutResult;
    }
    
    // 增加額外等待，確保導航有效
    await wait(2000);
    
    // 檢查是否成功導航到結帳頁面
    if (window.location.pathname.includes('/cart') || window.location.pathname.includes('/checkout')) {
      console.log('已成功導航到結帳相關頁面:', window.location.pathname);
    } else {
      console.log('可能未成功導航到結帳頁面，嘗試使用備份方法');
      // 備份方法：使用 proceedToCheckout 函數
      await proceedToCheckout();
    }
    
    // 通知結帳完成
    chrome.runtime.sendMessage({
      type: 'checkoutComplete',
      success: true,
      message: '已成功加入購物車並點擊結帳按鈕'
    });
    
    return {success: true, message: '已成功加入購物車並點擊結帳按鈕'};
  } catch (error) {
    console.error('自動結帳過程出錯:', error);
    
    // 嘗試使用最後的備用方法 - 直接導航
    try {
      console.log('發生錯誤，使用備用方法直接導航到購物車');
      window.location.href = '/cart';
    } catch (e) {
      console.error('備用導航也失敗:', e);
    }
    
    // 通知結帳失敗
    chrome.runtime.sendMessage({
      type: 'checkoutComplete',
      success: false,
      message: `結帳過程出錯: ${error.message}`
    });
    
    return {success: false, error: error.message};
  }
}

// 設定購買數量
function setQuantity(quantity) {
  // 尋找數量輸入欄位 - 優先使用 Soorploom 特定的選擇器
  const quantityInput = document.querySelector('input[aria-label="Quantity"], input[id="quantity"], input[name="quantity"], .quantity-input, [data-quantity-input], [aria-label*="quantity"]');
  
  if (quantityInput) {
    // 設定數量
    quantityInput.value = quantity;
    quantityInput.dispatchEvent(new Event('change', {bubbles: true}));
    quantityInput.dispatchEvent(new Event('input', {bubbles: true}));
    return {success: true, message: `已設定購買數量: ${quantity}`};
  }
  
  // 尋找增加數量按鈕
  const increaseBtn = document.querySelector('.quantity__plus, .qty-plus, [data-quantity="plus"]');
  if (increaseBtn) {
    // 預設通常是 1，因此點擊 quantity-1 次
    for (let i = 1; i < quantity; i++) {
      increaseBtn.click();
    }
    return {success: true, message: `已設定購買數量: ${quantity}`};
  }
  
  return {success: false, message: '找不到數量輸入欄位'};
}

// 選擇尺寸
function selectSize(size) {
  // 嘗試不同類型的尺寸選擇器
  
  // 1. 下拉選單
  const sizeSelect = document.querySelector('select[name="options[Size]"], select[id*="Size"], select[class*="size"]');
  if (sizeSelect) {
    for (const option of sizeSelect.options) {
      if (option.text.includes(size) || option.value.includes(size)) {
        sizeSelect.value = option.value;
        sizeSelect.dispatchEvent(new Event('change', {bubbles: true}));
        return {success: true, message: `已選擇尺寸: ${size}`};
      }
    }
  }
  
  // 2. 單選按鈕或尺寸塊
  const sizeOptions = document.querySelectorAll('.swatch-element, [data-value*="size"], [data-option-value]');
  for (const option of sizeOptions) {
    if (option.textContent.includes(size) || 
        option.getAttribute('data-value')?.includes(size) || 
        option.getAttribute('data-option-value')?.includes(size)) {
      // 點擊尺寸選項
      option.click();
      return {success: true, message: `已選擇尺寸: ${size}`};
    }
  }
  
  return {success: false, message: `找不到尺寸選項: ${size}`};
}

// 點擊"加入購物車"按鈕
function clickAddToCart() {
  // 尋找各種可能的"加入購物車"按鈕
  const addToCartButton = document.querySelector(
    'button[type="submit"][name="add"], button[name="add"], [data-add-to-cart], .add-to-cart, #AddToCart, .product-form__cart-submit, [data-button-action="add-to-cart"]'
  );
  
  if (addToCartButton) {
    // 確保按鈕未被禁用
    if (!addToCartButton.disabled) {
      addToCartButton.click();
      return {success: true, message: '已點擊加入購物車按鈕'};
    } else {
      return {success: false, message: '加入購物車按鈕已被禁用，可能商品已售完'};
    }
  }
    return {success: false, message: '找不到加入購物車按鈕'};
}

// 點擊"Checkout"按鈕
function clickCheckoutButton() {
  // 尋找各種可能的"Checkout"按鈕或鏈接
  console.log('尋找結帳按鈕...');
  
  // 優先查找明確標示為 "Checkout" 的連結
  const checkoutButtonText = document.evaluate(
    "//a[contains(text(), 'Checkout') or contains(text(), '結帳')]", 
    document, 
    null, 
    XPathResult.FIRST_ORDERED_NODE_TYPE, 
    null
  ).singleNodeValue;
  
  if (checkoutButtonText) {
    console.log('找到結帳按鈕（文字匹配）:', checkoutButtonText);
    // 使用多種方式觸發點擊
    try {
      // 方法1: 使用 click() 方法
      checkoutButtonText.click();
      
      // 方法2: 使用事件
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      checkoutButtonText.dispatchEvent(clickEvent);
      
      // 方法3: 如果是連結，直接使用它的 href 屬性
      if (checkoutButtonText.href) {
        console.log('使用連結重定向:', checkoutButtonText.href);
        window.location.href = checkoutButtonText.href;
      }
      
      return {success: true, message: '已點擊結帳按鈕（文字匹配）'};
    } catch (e) {
      console.error('點擊結帳按鈕失敗:', e);
    }
  }
  
  // 如果通過文字沒有找到，嘗試傳統的選擇器
  const checkoutButton = document.querySelector(
    'a[href="/cart"], a[href*="checkout"], [href="/cart"], [href*="checkout"], .checkout-button, [name="checkout"], [data-action="checkout"], .cart-checkout-button, form[action="/cart"] button, form[action="/checkout"] button'
  );
  
  if (checkoutButton) {
    console.log('找到結帳按鈕（選擇器匹配）:', checkoutButton);
    // 確保按鈕未被禁用
    if (!checkoutButton.disabled) {
      try {
        // 使用多種方式觸發點擊
        checkoutButton.click();
        
        // 使用自定義事件
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        checkoutButton.dispatchEvent(clickEvent);
        
        // 如果是連結，直接使用它的 href 屬性
        if (checkoutButton.href) {
          console.log('使用連結重定向:', checkoutButton.href);
          window.location.href = checkoutButton.href;
        }
        
        return {success: true, message: '已點擊結帳按鈕'};
      } catch (e) {
        console.error('點擊結帳按鈕失敗:', e);
      }
    } else {
      return {success: false, message: '結帳按鈕已被禁用'};
    }
  }
  
  // 檢查購物車抽屜或彈出窗口
  const cartDrawer = document.querySelector('.cart-drawer, .drawer, .mini-cart, .cart-modal, .cart-popup, #cart-drawer');
  if (cartDrawer) {
    console.log('找到購物車抽屜，嘗試在抽屜中找結帳按鈕');
    const drawerCheckoutButton = cartDrawer.querySelector('[name="checkout"], [href*="checkout"], .checkout-button, .cart-checkout-button');
    if (drawerCheckoutButton) {
      console.log('找到抽屜中的結帳按鈕:', drawerCheckoutButton);
      drawerCheckoutButton.click();
      
      if (drawerCheckoutButton.href) {
        window.location.href = drawerCheckoutButton.href;
      }
      
      return {success: true, message: '已點擊購物車抽屜中的結帳按鈕'};
    }
  }
  
  // 如果找不到任何按鈕，嘗試直接導航到結帳頁面
  console.log('未找到結帳按鈕，直接導航到購物車頁面');
  window.location.href = '/cart';
  
  // 設定一個計時器，確保頁面導航後仍無法前往結帳，將嘗試直接訪問結帳頁面
  setTimeout(() => {
    window.location.href = '/checkout';
  }, 5000);
  
  return {success: true, message: '找不到結帳按鈕，正在導航到購物車頁面'};
}

// 進入結帳頁面
async function proceedToCheckout() {
  console.log('嘗試使用 proceedToCheckout 函數進入結帳頁面');
  
  // 等待購物車更新
  await wait(2000);
  
  // 檢查是否有彈出式購物車
  const cartDrawer = document.querySelector('.cart-drawer, .mini-cart, .drawer, .cart-modal, .cart-popup, #cart-drawer');
  if (cartDrawer) {
    console.log('找到彈出式購物車:', cartDrawer);
    
    // 在彈出式購物車中尋找結帳按鈕
    const checkoutButton = cartDrawer.querySelector('[name="checkout"], .checkout-button, [href*="checkout"], .cart-checkout-button, form[action="/checkout"] button');
    if (checkoutButton) {
      console.log('點擊彈出式購物車中的結帳按鈕:', checkoutButton);
      checkoutButton.click();
      
      // 如果是連結，也直接使用href
      if (checkoutButton.href) {
        console.log('使用連結跳轉:', checkoutButton.href);
        window.location.href = checkoutButton.href;
      }
      
      return {success: true, message: '已在彈出式購物車中點擊結帳按鈕'};
    }
  }
  
  // 檢查頁面上的其他結帳按鈕
  const checkoutButtons = document.querySelectorAll('form[action="/cart"], form[action="/checkout"], .cart-checkout, .checkout-btn, a.checkout, .cart__checkout');
  if (checkoutButtons.length > 0) {
    console.log('找到頁面上的表單或結帳按鈕:', checkoutButtons[0]);
    
    // 如果是表單，嘗試提交
    if (checkoutButtons[0].tagName === 'FORM') {
      checkoutButtons[0].submit();
      return {success: true, message: '已提交結帳表單'};
    } else {
      // 否則嘗試點擊
      checkoutButtons[0].click();
      return {success: true, message: '已點擊結帳按鈕'};
    }
  }
  
  // 如果還是找不到，使用 XPath 嘗試尋找文字內容包含「結帳」的元素
  const checkoutButtonText = document.evaluate(
    "//a[contains(text(), 'Checkout') or contains(text(), '結帳') or contains(text(), '去買單')]|//button[contains(text(), 'Checkout') or contains(text(), '結帳') or contains(text(), '去買單')]", 
    document, 
    null, 
    XPathResult.FIRST_ORDERED_NODE_TYPE, 
    null
  ).singleNodeValue;
  
  if (checkoutButtonText) {
    console.log('使用文字內容找到結帳按鈕:', checkoutButtonText);
    checkoutButtonText.click();
    
    if (checkoutButtonText.href) {
      window.location.href = checkoutButtonText.href;
    }
    
    return {success: true, message: '已點擊包含結帳文字的按鈕'};
  }
  
  // 如果沒有彈出式購物車，則嘗試導航到結帳頁面
  console.log('無法找到結帳按鈕，嘗試直接導航');
  
  // 如果目前在購物車頁面，嘗試直接導航到結帳頁面
  if (window.location.pathname.includes('/cart')) {
    window.location.href = '/checkout';
  } else {
    // 否則先進入購物車頁面
    window.location.href = '/cart';
    
    // 設定一個計時器，確保頁面導航後再導航到結帳頁面
    setTimeout(() => {
      window.location.href = '/checkout';
    }, 5000);
  }
  
  return {success: true, message: '正在嘗試直接導航到結帳頁面'};
}

// 處理頁面上可能的彈出窗口或確認對話框
function handlePopups() {
  console.log('檢查頁面上的彈出窗口');
  
  // 處理常見的模態對話框
  const modals = document.querySelectorAll('.modal, .modal-container, .popup, .popup-container, [aria-modal="true"]');
  modals.forEach(modal => {
    console.log('找到模態對話框:', modal);
    
    // 尋找確認按鈕
    const confirmButtons = modal.querySelectorAll('button[type="submit"], button.confirm, button.accept, button.continue, button.proceed, [data-confirm], .proceed-to-checkout');
    if (confirmButtons.length > 0) {
      console.log('點擊模態對話框中的確認按鈕:', confirmButtons[0]);
      confirmButtons[0].click();
    }
    
    // 尋找關閉按鈕
    const closeButtons = modal.querySelectorAll('.close, .close-modal, .modal-close, [data-dismiss="modal"], button.cancel');
    if (closeButtons.length > 0) {
      console.log('點擊模態對話框中的關閉按鈕:', closeButtons[0]);
      closeButtons[0].click();
    }
  });
  
  // 處理「加入購物車成功」提示 - 尋找「前往結帳」按鈕
  const cartNotifications = document.querySelectorAll('.cart-notification, .added-to-cart, .cart-popup, .cart-drawer, [data-cart-notification]');
  cartNotifications.forEach(notification => {
    console.log('找到購物車通知:', notification);
    
    // 尋找前往結帳按鈕
    const checkoutLinks = notification.querySelectorAll('a[href="/checkout"], a[href*="checkout"], [data-checkout-button], .checkout-button');
    if (checkoutLinks.length > 0) {
      console.log('點擊購物車通知中的結帳按鈕:', checkoutLinks[0]);
      
      // 使用多種方式觸發點擊
      checkoutLinks[0].click();
      
      // 如果是連結，也直接使用href
      if (checkoutLinks[0].href) {
        console.log('使用連結跳轉:', checkoutLinks[0].href);
        window.location.href = checkoutLinks[0].href;
      }
    }
  });
}

// 創建監控按鈕
function createActionButtons() {
  if (!isProductPage()) return;
  
  // 創建按鈕容器
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'soorploom-buttons';
  buttonContainer.style.cssText = `
    position: fixed;
    top: 100px;
    right: 20px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `;
  
  // 創建監控按鈕
  const monitorButton = document.createElement('button');
  monitorButton.textContent = '加入監控商品';
  monitorButton.style.cssText = `
    padding: 10px 15px;
    background-color: #4CAF50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  `;
  monitorButton.addEventListener('click', addCurrentProductToMonitor);
  
  // 創建數量選擇器容器
  const quantityContainer = document.createElement('div');
  quantityContainer.style.cssText = `
    display: flex;
    align-items: center;
    background-color: white;
    padding: 5px;
    border-radius: 4px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  `;
  
  // 創建數量標籤
  const quantityLabel = document.createElement('span');
  quantityLabel.textContent = '欲購買數量：';
  quantityLabel.style.cssText = `
    margin-right: 5px;
    font-weight: bold;
  `;
  
  // 創建數量輸入框
  const quantityInput = document.createElement('input');
  quantityInput.type = 'number';
  quantityInput.min = '1';
  quantityInput.value = '1';
  quantityInput.style.cssText = `
    width: 50px;
    padding: 5px;
    border: 1px solid #ccc;
    border-radius: 4px;
  `;
  quantityInput.id = 'soorploom-quantity';
  
  // 添加元素到數量容器
  quantityContainer.appendChild(quantityLabel);
  quantityContainer.appendChild(quantityInput);
  
  // 添加按鈕和數量選擇器到容器
  buttonContainer.appendChild(monitorButton);
  buttonContainer.appendChild(quantityContainer);
  
  // 添加容器到頁面
  document.body.appendChild(buttonContainer);
}

// 啟動當前頁面的監控
function startPageMonitoring(enableAutoCheckout, interval, isSequential = false, currentIndex = 0, totalProducts = 0) {
  // 避免重複啟動
  if (isPageMonitoring) {
    stopPageMonitoring();
  }
  
  isPageMonitoring = true;
  autoCheckoutEnabled = enableAutoCheckout || false;
  
  // 設定刷新間隔
  if (interval && interval >= 5) {
    refreshIntervalSeconds = interval;
  } else {
    // 如果沒有指定間隔，或間隔太短，使用儲存的設定或預設值
    chrome.storage.sync.get('refreshInterval', function(data) {
      if (data.refreshInterval && data.refreshInterval >= 5) {
        refreshIntervalSeconds = data.refreshInterval;
        restartMonitoringWithNewInterval();
      }
    });
  }
  
  // 創建或更新監控狀態指示器
  createOrUpdateMonitoringIndicator(true, isSequential, currentIndex, totalProducts);
  
  // 開始監控當前頁面
  startMonitoringInterval();
  
  // 立即執行一次檢查
  checkCurrentPageStock();
  
  showNotification(`此頁面已開始庫存監控，每 ${refreshIntervalSeconds} 秒檢查一次`);
}

// 更新刷新間隔
function updateRefreshInterval(interval) {
  if (interval && interval >= 5) {
    refreshIntervalSeconds = interval;
    
    // 如果正在監控，則重新啟動監控
    if (isPageMonitoring) {
      restartMonitoringWithNewInterval();
      showNotification(`監控刷新間隔已更新為 ${refreshIntervalSeconds} 秒`);
    }
  }
}

// 使用新的間隔重新啟動監控
function restartMonitoringWithNewInterval() {
  if (pageMonitoringInterval) {
    clearInterval(pageMonitoringInterval);
  }
  
  startMonitoringInterval();
}

// 啟動監控間隔
function startMonitoringInterval() {
  pageMonitoringInterval = setInterval(checkCurrentPageStock, refreshIntervalSeconds * 1000);
}

// 停止當前頁面的監控
function stopPageMonitoring() {
  if (pageMonitoringInterval) {
    clearInterval(pageMonitoringInterval);
    pageMonitoringInterval = null;
  }
  
  isPageMonitoring = false;
  
  // 更新監控狀態指示器
  createOrUpdateMonitoringIndicator(false);
  
  showNotification('頁面監控已停止');
}

// 檢查當前頁面上的商品庫存
async function checkCurrentPageStock() {
  try {
    if (!isPageMonitoring) return;
    
    // 如果當前頁面是產品頁面
    if (isProductPage()) {
      const currentProduct = await extractProductInfo();
      if (!currentProduct) return;
      
      // 檢查此產品是否在監控列表中
      chrome.storage.sync.get('monitoredProducts', async function(data) {
        const monitoredProducts = data.monitoredProducts || [];
        const matchingProduct = monitoredProducts.find(p => p.url === currentProduct.url || p.name === currentProduct.name);
        
        if (matchingProduct) {
          // 保留原有的數量資訊
          if (!currentProduct.quantity && matchingProduct.quantity) {
            currentProduct.quantity = matchingProduct.quantity;
          }
          
          // 檢查庫存狀態
          if (currentProduct.inStock) {
            showNotification(`監控商品 ${currentProduct.name} 有庫存！${autoCheckoutEnabled ? '準備自動結帳...' : ''}`);
            
            // 如果開啟了自動結帳且有庫存，則進行結帳
            if (autoCheckoutEnabled) {
              await initiateCheckout(currentProduct);
            }
          } else {
            console.log(`監控商品 ${currentProduct.name} 目前無庫存，繼續監控中...`);
          }
          
          // 檢查是否是序列化監控，如果是，通知背景腳本前往下一個商品
          const indicator = document.getElementById('soorploom-monitor-indicator');
          if (indicator && indicator.textContent.includes('/')) {
            // 表示這是序列化監控
            const matches = indicator.textContent.match(/（(\d+)\/(\d+)）/);
            if (matches && matches.length === 3) {
              const currentIndex = parseInt(matches[1], 10) - 1;
              const totalProducts = parseInt(matches[2], 10);
              
              // 延遲後通知背景腳本前往下一個商品
              setTimeout(() => {
                chrome.runtime.sendMessage({
                  type: 'navigateToNext',
                  currentIndex: currentIndex,
                  totalProducts: totalProducts
                });
              }, 3000);
            }
          } else {
            // 不是序列化監控，重新載入頁面以刷新庫存狀態
            setTimeout(() => {
              window.location.reload();
            }, 1000);
          }
        } else {
          console.log('當前產品不在監控列表中');
          
          // 如果是序列化監控，也要繼續前往下一個
          const indicator = document.getElementById('soorploom-monitor-indicator');
          if (indicator && indicator.textContent.includes('/')) {
            const matches = indicator.textContent.match(/（(\d+)\/(\d+)）/);
            if (matches && matches.length === 3) {
              const currentIndex = parseInt(matches[1], 10) - 1;
              const totalProducts = parseInt(matches[2], 10);
              
              // 延遲後通知背景腳本前往下一個商品
              setTimeout(() => {
                chrome.runtime.sendMessage({
                  type: 'navigateToNext',
                  currentIndex: currentIndex,
                  totalProducts: totalProducts
                });
              }, 3000);
            }
          }
        }
      });
    } 
    // 如果當前頁面是產品列表頁面
    else if (isProductListPage()) {
      const products = await fetchProductsFromListPage();
      
      // 檢查列表中是否有監控的商品
      chrome.storage.sync.get('monitoredProducts', function(data) {
        const monitoredProducts = data.monitoredProducts || [];
        let foundMonitoredProducts = false;
        
        for (const product of products) {
          const matchingProduct = monitoredProducts.find(p => p.url === product.url || p.name === product.name);
          
          if (matchingProduct && product.inStock) {
            foundMonitoredProducts = true;
            showNotification(`監控商品 ${product.name} 有庫存！點擊進入商品頁面`);
            
            // 如果需要自動結帳，導航到商品頁面
            if (autoCheckoutEnabled) {
              window.location.href = product.url;
              return; // 終止函數，避免重新載入當前頁面
            }
          }
        }
        
        if (!foundMonitoredProducts) {
          console.log('此頁面上沒有發現有庫存的監控商品');
          
          // 重新載入頁面以刷新庫存狀態
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
      });
    } else {
      console.log('此頁面不是產品頁面或產品列表頁面，無法監控庫存');
    }
  } catch (error) {
    console.error('檢查當前頁面庫存時出錯:', error);
  }
}

// 創建或更新監控狀態指示器
function createOrUpdateMonitoringIndicator(isMonitoring, isSequential = false, currentIndex = 0, totalProducts = 0) {
  let indicator = document.getElementById('soorploom-monitor-indicator');
  
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'soorploom-monitor-indicator';
    indicator.style.cssText = `
      position: fixed;
      bottom: 10px;
      left: 10px;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      z-index: 10000;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    `;
    document.body.appendChild(indicator);
  }
  
  if (isMonitoring) {
    if (isSequential) {
      indicator.textContent = `🔄 庫存監控中...（${currentIndex + 1}/${totalProducts}）`;
    } else {
      indicator.textContent = `🔄 庫存監控中...（${refreshIntervalSeconds} 秒刷新）`;
    }
    indicator.style.backgroundColor = '#4CAF50';
    indicator.style.color = 'white';
  } else {
    indicator.textContent = '⏹️ 庫存監控已停止';
    indicator.style.backgroundColor = '#f44336';
    indicator.style.color = 'white';
    
    // 3秒後隱藏指示器
    setTimeout(() => {
      indicator.style.opacity = '0';
      setTimeout(() => {
        indicator.remove();
      }, 300);
    }, 3000);
  }
}

// 輔助函數: 等待指定毫秒數
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 在頁面加載時自動執行
(function() {
  console.log('Soorploom Clothier Helper: 內容腳本已載入');
  
  // 添加監控按鈕
  setTimeout(createActionButtons, 1000);
  
  // 載入監控商品列表
  chrome.storage.sync.get('monitoredProducts', function(data) {
    monitoredProducts = data.monitoredProducts || [];
  });
  
  // 載入刷新間隔設定
  chrome.storage.sync.get('refreshInterval', function(data) {
    if (data.refreshInterval && data.refreshInterval >= 5) {
      refreshIntervalSeconds = data.refreshInterval;
    }
    
    // 檢查是否已啟用監控
    chrome.storage.sync.get('isMonitoring', function(data) {
      if (data.isMonitoring) {
        // 查詢自動結帳狀態
        chrome.storage.sync.get('autoCheckout', function(checkoutData) {
          // 在頁面載入後啟動監控
          setTimeout(() => {
            startPageMonitoring(checkoutData.autoCheckout || false, refreshIntervalSeconds);
          }, 2000);
        });
      }
    });
  });
  
  // 如果在產品頁面，則自動提取產品信息
  if (isProductPage()) {
    extractProductInfo().then(product => {
      if (product) {
        productData = [product];
      }
    });
  }
})();