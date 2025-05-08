// 全局變數
let productData = [];
let monitoredProducts = []; // 追蹤已監控的商品

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
    });
    
    return true; // 表示將非同步回應
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
      
      let inStock = true;
      const soldOutElement = card.querySelector('.sold-out, .out-of-stock');
      if (soldOutElement) {
        inStock = false;
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
    
    // 找到產品庫存狀態
    let inStock = true;
    const soldOutElement = document.querySelector('.sold-out, .out-of-stock, [data-sold-out]');
    if (soldOutElement) {
      inStock = false;
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
    
    showNotification(`已將 ${product.name} 添加到監控列表`);
  } catch (error) {
    console.error('添加商品到監控列表時出錯:', error);
    showNotification('添加商品到監控列表時出錯: ' + error.message);
  }
}

// 檢查所有監控商品的庫存
function checkAllMonitoredProducts() {
  chrome.runtime.sendMessage({
    type: 'statusUpdate',
    message: '開始檢查所有監控商品的庫存'
  });
  
  chrome.storage.sync.get('monitoredProducts', function(data) {
    const products = data.monitoredProducts || [];
    if (products.length === 0) {
      showNotification('監控列表為空');
      return;
    }
    
    showNotification(`開始檢查 ${products.length} 個監控商品的庫存`);
    
    // 向背景腳本發送檢查庫存的請求
    chrome.runtime.sendMessage({
      type: 'startMonitoring',
      settings: {}
    });
  });
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
    // 如果不在產品頁面，則導航到產品頁面
    if (!isProductPage()) {
      window.location.href = product.url;
      return {success: false, message: '正在導航到產品頁面'};
    }
    
    // 選擇尺寸（如果有）
    if (product.sizes && product.sizes.length > 0) {
      selectSize(product.sizes[0]);
    }
    
    // 點擊"加入購物車"按鈕
    const addToCartResult = clickAddToCart();
    if (!addToCartResult.success) {
      return addToCartResult;
    }
    
    // 等待購物車更新
    await wait(2000);
    
    // 點擊"結帳"按鈕或導航到結帳頁面
    const checkoutResult = await proceedToCheckout();
    if (!checkoutResult.success) {
      return checkoutResult;
    }
    
    // 通知結帳完成
    chrome.runtime.sendMessage({
      type: 'checkoutComplete',
      success: true,
      message: '已成功加入購物車並導航到結帳頁面'
    });
    
    return {success: true, message: '自動結帳流程已完成'};
  } catch (error) {
    console.error('自動結帳過程出錯:', error);
    
    // 通知結帳失敗
    chrome.runtime.sendMessage({
      type: 'checkoutComplete',
      success: false,
      message: `結帳過程出錯: ${error.message}`
    });
    
    return {success: false, error: error.message};
  }
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
    '[name="add"], [data-add-to-cart], .add-to-cart, #AddToCart, .product-form__cart-submit, [data-button-action="add-to-cart"]'
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

// 進入結帳頁面
async function proceedToCheckout() {
  // 等待購物車更新
  await wait(2000);
  
  // 檢查是否有彈出式購物車
  const cartDrawer = document.querySelector('.cart-drawer, .mini-cart, .drawer');
  if (cartDrawer) {
    // 在彈出式購物車中尋找結帳按鈕
    const checkoutButton = cartDrawer.querySelector('[name="checkout"], .checkout-button, [href*="checkout"]');
    if (checkoutButton) {
      checkoutButton.click();
      return {success: true, message: '已在彈出式購物車中點擊結帳按鈕'};
    }
  }
  
  // 如果沒有彈出式購物車，則嘗試導航到結帳頁面
  window.location.href = '/checkout';
  return {success: true, message: '正在導航到結帳頁面'};
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
  
  // 創建庫存檢查按鈕
  const checkButton = document.createElement('button');
  checkButton.textContent = '檢查所有監控商品';
  checkButton.style.cssText = `
    padding: 10px 15px;
    background-color: #2196F3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  `;
  checkButton.addEventListener('click', checkAllMonitoredProducts);
  
  // 創建顯示監控列表按鈕
  const listButton = document.createElement('button');
  listButton.textContent = '顯示監控列表';
  listButton.style.cssText = `
    padding: 10px 15px;
    background-color: #9C27B0;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  `;
  listButton.addEventListener('click', updateMonitoredProductsList);
  
  // 添加按鈕到容器
  buttonContainer.appendChild(monitorButton);
  buttonContainer.appendChild(checkButton);
  buttonContainer.appendChild(listButton);
  
  // 添加容器到頁面
  document.body.appendChild(buttonContainer);
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
  
  // 如果在產品頁面，則自動提取產品信息
  if (isProductPage()) {
    extractProductInfo().then(product => {
      if (product) {
        productData = [product];
      }
    });
  }
})();