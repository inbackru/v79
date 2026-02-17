// Property Card Click Handler  
// Navigate to detail page when clicking on property cards

console.log('🔧 Property card click handler loading...');

// Use event delegation on document for property cards
document.addEventListener('click', function(e) {
    // Find the property card (could be the target or an ancestor)
    const card = e.target.closest('.property-card');
    
    if (!card) return;
    
    console.log('🖱️ Click on property card detected');
    
    // Ignore clicks on interactive elements
    const isButton = e.target.closest('button');
    const isLink = e.target.closest('a');
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT';
    
    if (isButton || isLink || isInput) {
        console.log('⏸️ Ignoring - interactive element');
        return;
    }
    
    // Navigate to property detail page
    const url = card.getAttribute('data-property-url');
    if (url) {
        console.log('🔗 Navigating to:', url);
        window.location.href = url;
    } else {
        console.error('❌ No URL on card');
    }
});

console.log('✅ Property card click handler installed');
